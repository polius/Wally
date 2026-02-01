const API_URL = '/api';

let currentDate = new Date();
let categories;
let tags;
let currency;

let chart;
let chartSelected = "currentMonth";
let chartDisabledFields = new Set();

let tagsInput;
let nameInput;

// Execute the main function when DOM has loaded
document.addEventListener('DOMContentLoaded', () => main());

async function main() {
  await checkLogin();
  await i18n.init();
  updateMonthHeaderAll();

  // Update monthHeaderAll when language changes
  i18n.onLanguageChange(() => {
    updateMonthHeaderAll();
  });

  document.getElementById('dashboardForm').reset();
  [categories, tags, currency] = await Promise.all([
    getCategories(),
    getTags(),
    getCurrency(),
    renderMonth(),
  ]);

  // Load chart
  await loadChart();

  // Render categories, tags and name autocomplete
  await renderCategories();
  await renderTags();
  await renderNameAutocomplete();

  // Show page after all translations are applied
  i18n.showPage();

  // Populate year dropdowns for custom range
  populateYearDropdowns();

  // Add event listeners for custom range toggle
  const customRangeRadio = document.getElementById('customRangeRadio');
  const customRangeInputs = document.getElementById('customRangeInputs');
  const rangeRadios = document.querySelectorAll('input[name="range"]');

  rangeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (customRangeRadio.checked) {
        customRangeInputs.classList.add('active');
      } else {
        customRangeInputs.classList.remove('active');
      }
    });
  });
}

async function getCategories() {
  const response = await fetch(`${API_URL}/categories`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const data = await response.json();
  return data;
}

async function getTags() {
  const response = await fetch(`${API_URL}/tags`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const data = await response.json();
  return data;
}

async function getCurrency() {
  const response = await fetch(`${API_URL}/currency`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const data = await response.json();
  return {
    name: data.selected,
    symbol: data.currencies.find(c => c.name === data.selected)?.symbol,
    position: data.position
  };
}

async function getTransactions() {
  let endpoint;
  if (chartSelected == 'currentMonth') {
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const year = currentDate.getFullYear();
    endpoint = `${API_URL}/transactions/date/${year}-${month}`;
  }
  else if (chartSelected == 'lastThreeMonths') {
    endpoint = `${API_URL}/transactions/past-3-months`;
  }
  else if (chartSelected == 'lastSixMonths') {
    endpoint = `${API_URL}/transactions/past-6-months`;
  }
  else if (chartSelected == 'lastYear') {
    endpoint = `${API_URL}/transactions/past-12-months`;
  }
  else if (chartSelected == 'yearToDate') {
    endpoint = `${API_URL}/transactions/year-to-date`;
  }
  else if (chartSelected == 'customRange') {
    const fromParts = window.customRangeFrom.split('-');
    const toParts = window.customRangeTo.split('-');
    endpoint = `${API_URL}/transactions/range/${fromParts[0]}-${fromParts[1]}/${toParts[0]}-${toParts[1]}`;
  }
  else if (chartSelected == 'allData') {
    endpoint = `${API_URL}/transactions/to-date`;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const json = await response.json()

    if (!response.ok) {
      if (response.status === 422) throw new Error(json.detail[0].msg)
      else if ([400, 404].includes(response.status)) throw new Error(json.detail)
      throw new Error("An error occurred.")
    }
    return json;
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

function renderMonth() {
  const monthNames = [
    i18n.t('common.months.january'),
    i18n.t('common.months.february'),
    i18n.t('common.months.march'),
    i18n.t('common.months.april'),
    i18n.t('common.months.may'),
    i18n.t('common.months.june'),
    i18n.t('common.months.july'),
    i18n.t('common.months.august'),
    i18n.t('common.months.september'),
    i18n.t('common.months.october'),
    i18n.t('common.months.november'),
    i18n.t('common.months.december')
  ];
  const monthText = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  document.getElementById('currentMonth').textContent = monthText;
}

// Prev month button
document.getElementById('prevMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderMonth();
  loadChart();
});

// Next month button
document.getElementById('nextMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderMonth();
  loadChart();
});

async function loadChart() {
  const transactions = await getTransactions();
  const chartBox = document.querySelector('.chart-box');
  const legendBox = document.getElementById('customLegend');
  const cashflowSection = document.getElementById('cashflow-section');
  const noDataMessage = document.getElementById('noDataMessage');
  const hasExpenses = transactions.some(t => t.type === 'expense');

  if (!hasExpenses) {
    chartBox.style.display = 'none';
    legendBox.style.display = 'none';
    cashflowSection.style.display = 'none';
    noDataMessage.style.display = 'block';
  }
  else {
    chartBox.style.display = 'flex';
    legendBox.style.display = 'flex';
    cashflowSection.style.display = 'flex';
    noDataMessage.style.display = 'none';

    const data = calculateBreakdown(transactions);
    updateChart(data);
    updateLegend(transactions, data);
    updateCashflow(transactions);
  }
}

function updateCashflow(transactions) {
  const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => Decimal.add(acc, t.amount).toNumber(), 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => Decimal.add(acc, t.amount).toNumber(), 0);
  const balance = Decimal.sub(income, expense);

  document.getElementById('cashflow-income').textContent = formatCurrency(income);
  document.getElementById('cashflow-expenses').textContent = formatCurrency(expense);
  document.getElementById('cashflow-balance').textContent = formatCurrency(balance);

  const balanceElement = document.getElementById('cashflow-balance');
  if (balance >= 0) {
    balanceElement.classList.add('positive');
    balanceElement.classList.remove('negative');
  } else {
    balanceElement.classList.add('negative');
    balanceElement.classList.remove('positive');
  }
}

const chartColors = [
  '#FF6B6B',
  '#FFA94D',
  '#FFE066',
  '#8CE99A',
  '#66D9E8',
  '#74C0FC',
  '#9775FA',
  '#F783AC',
  '#E9ECEF'
];

function updateChart(data) {
  if (chart) chart.destroy();

  if (chartSelected == 'currentMonth') {
    chart = new Chart('chartCanvas', {
      type: 'doughnut',
      data: {
        labels: data.map(x => x.name),
        datasets: [{
          data: data.map(x => x.total),
          backgroundColor: chartColors,
          borderColor: '#1a1a1a',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const category = data[index].name;
            window.location.href = `transactions?category=${encodeURIComponent(category)}`;
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            boxPadding: 3,
            usePointStyle: true,
            callbacks: {
              label: (context) => {
                const value = context.raw;
                const total = context.dataset.data.reduce((sum, val) => Decimal.add(sum, val).toNumber(), 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${formatCurrency(value)} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }
  else {
    // Compute labels based on the selected range
    let range;
    if (chartSelected === 'lastThreeMonths') range = getLastNMonths(3);
    else if (chartSelected === 'lastSixMonths') range = getLastNMonths(6);
    else if (chartSelected === 'lastYear') range = getLastNMonths(12);
    else if (chartSelected === 'yearToDate') range = getYearToDate();
    else if (chartSelected === 'customRange') range = getCustomMonthRange(window.customRangeFrom, window.customRangeTo);
    else if (chartSelected === 'allData') range = getAllMonths(data);

    chart = new Chart('chartCanvas', {
      type: 'line',
      data: {
        labels: range.map(x => formatDate(x)),
        datasets: data.map((item, index) => ({
          label: item.name,
          data: range.map(m => {
            const idx = item.dates.indexOf(m);
            return idx !== -1 ? item.amounts[idx] : 0;
          }),
          fill: false,
          backgroundColor: chartColors[index % chartColors.length],
          borderColor: chartColors[index % chartColors.length],
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: chartColors[index % chartColors.length],
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: chartColors[index % chartColors.length],
          pointHoverBorderWidth: 2,
          tension: 0.3,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            grid: {
              display: true,
              drawOnChartArea: true,
              drawTicks: true,
              color: 'rgba(0, 0, 0, 0.05)',
            },
            ticks: {
              maxRotation: 45,
              minRotation: 0,
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              display: true,
              color: 'rgba(0, 0, 0, 0.05)',
            },
            ticks: {
              callback: function(value) {
                return formatCurrency(value);
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: {
              size: 14,
              weight: 'bold'
            },
            bodyFont: {
              size: 13
            },
            bodySpacing: 6,
            footerFont: {
              size: 13,
            },
            footerMarginTop: 8,
            footerSpacing: 4,
            displayColors: true,
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            usePointStyle: true,
            boxPadding: 6,
            callbacks: {
              label: (context) => {
                const value = context.raw;
                const total = context.dataset.data.reduce((sum, val) => Decimal.add(sum, val).toNumber(), 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${context.dataset.label}: ${formatCurrency(value)} (${percentage}%)`;
              },
              beforeFooter: () => {
                return '─'.repeat(20);
              },
              footer: (tooltipItems) => {
                const total = tooltipItems.reduce((sum, item) => Decimal.add(sum, item.raw).toNumber(), 0);
                return `Total: ${formatCurrency(total)}`;
              }
            }
          }
        }
      }
    });
  }
}

function calculateBreakdown(transactions) {
  const breakdownMap = {};

  for (const { type, amount, date, ...rest } of transactions) {
    const groupValue = rest.category;

    if (type === 'expense' && !chartDisabledFields.has(groupValue)) {
      if (!breakdownMap[groupValue]) {
        breakdownMap[groupValue] = { total: 0, months: {} };
      }

      const monthKey = date.slice(0, 7); // YYYY-MM
      breakdownMap[groupValue].total = Decimal.add(breakdownMap[groupValue].total, amount).toNumber();
      breakdownMap[groupValue].months[monthKey] = Decimal.add((breakdownMap[groupValue].months[monthKey] || 0), amount).toNumber();
    }
  }

  const result = Object.entries(breakdownMap)
  .map(([name, { total, months }]) => {
    const sortedMonths = Object.keys(months).sort();
    return {
      name,
      total,
      dates: sortedMonths,
      amounts: sortedMonths.map(m => months[m])
    };
  })
  .sort((a, b) => b.total - a.total);

  const grandTotal = result.reduce((sum, item) => Decimal.add(sum, item.total).toNumber(), 0);

  // Add percentage field
  return result.map(item => ({
    ...item,
    percentage: grandTotal ? (item.total / grandTotal) * 100 : 0
  }));
}

function updateLegend(transactions, data) {
  const legendContainer = document.getElementById('customLegend');
  legendContainer.innerHTML = '';

  const monthExpenses = transactions.filter(t => t.type === 'expense');
  const labelMap = new Map(data.map(x => [x.name, x]));

  monthExpenses
  .map(exp => exp.category)
  .filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
  .sort((a, b) => {
    const da = labelMap.get(a), db = labelMap.get(b);
    if (da && db) return db.total - da.total;
    if (da) return -1;
    if (db) return 1;
    return a.localeCompare(b);
  })
  .forEach((label, index) => {
    const categoryData = labelMap.get(label);
    const color = chartColors[index % chartColors.length];
    const percentage = categoryData ? ` (${categoryData.percentage.toFixed(1)}%)` : '';
    const amount = categoryData ? formatCurrency(categoryData.total) : '';
    const item = document.createElement('div');
    item.className = `legend-item${chartDisabledFields.has(label) ? ' disabled' : ''}`;
    item.innerHTML = `
    <div class="color-box" style="background-color: ${color}"></div>
    <div class="legend-text">
    <span>${label}${percentage}</span>
    <span class="amount">${amount}</span>
    </div>
    `;
    item.addEventListener('click', () => toggleLegend(label));
    legendContainer.appendChild(item);
  });

  const activeTotal = monthExpenses
  .filter(x => !chartDisabledFields.has(x.category))
  .reduce((sum, x) => Decimal.add(sum, x.amount).toNumber(), 0);

  legendContainer.insertAdjacentHTML('beforeend', `
  <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--bs-border-color);">
  <div style="display: flex; justify-content: flex-end; align-items: center;">
  <span class="amount">Total: <span style="font-weight: bold">${formatCurrency(activeTotal)}</span></span>
  </div>
  </div>
  `);
}

function formatCurrency(amount) {
  if (currency.position === 'left') {
    if (Decimal(amount) < 0) return `-${currency.symbol}${Decimal(amount).abs()}`;
    else return `${currency.symbol}${amount}`;
  }
  else return `${amount} ${currency.symbol}`;
}

function toggleLegend(label) {
  if (chartDisabledFields.has(label)) chartDisabledFields.delete(label);
  else chartDisabledFields.add(label);
  loadChart();
}

function populateYearDropdowns() {
  const currentYear = new Date().getFullYear();
  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

  // Set current month and year as defaults
  document.getElementById('fromMonthSelect').value = currentMonth;
  document.getElementById('fromYearSelect').value = currentYear;
  document.getElementById('toMonthSelect').value = currentMonth;
  document.getElementById('toYearSelect').value = currentYear;
}

function submitDashboard(event) {
  event.preventDefault();

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  // Store the selected range and group in the global variable
  chartSelected = data.range;

  // Validate custom range if selected
  if (chartSelected === 'customRange') {
    const fromMonth = document.getElementById('fromMonthSelect').value;
    const fromYear = document.getElementById('fromYearSelect').value;
    const toMonth = document.getElementById('toMonthSelect').value;
    const toYear = document.getElementById('toYearSelect').value;

    // Parse values
    const fromYearNum = parseInt(fromYear);
    const toYearNum = parseInt(toYear);
    const fromMonthStr = `${fromYear}-${fromMonth}`;
    const toMonthStr = `${toYear}-${toMonth}`;

    if (fromMonthStr > toMonthStr) {
      alert(i18n.t('dashboard.modal.invalid_date_range'));
      return;
    }

    // Store custom range values globally
    window.customRangeFrom = fromMonthStr;
    window.customRangeTo = toMonthStr;
  }

  // Update header
  const monthHeader = document.getElementById('monthHeader');
  const monthHeaderAll = document.getElementById('monthHeaderAll');
  if (chartSelected == 'currentMonth') {
    monthHeader.style.display = 'flex';
    monthHeaderAll.style.display = 'none';
  }
  else {
    monthHeader.style.display = 'none';
    monthHeaderAll.style.display = 'flex';
    const mapRange = {
      "lastThreeMonths": i18n.t('dashboard.modal.past_3_months'),
      "lastSixMonths": i18n.t('dashboard.modal.past_6_months'),
      "lastYear": i18n.t('dashboard.modal.past_12_months'),
      "yearToDate": i18n.t('dashboard.modal.year_to_date'),
      "allData": i18n.t('dashboard.modal.to_date')
    };
    monthHeaderAll.innerText = chartSelected === 'customRange'
    ? `${formatDate(window.customRangeFrom)} - ${formatDate(window.customRangeTo)}`
    : mapRange[chartSelected];
  }

  // Load the chart with the new selection
  chartDisabledFields = new Set();
  loadChart();

  // Hide the modal
  const modal = bootstrap.Modal.getInstance(document.getElementById('dashboardModal'));
  modal.hide();
}

function getLastNMonths(n) {
  // Generate previous n months including current month
  const months = [];
  const today = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${d.getFullYear()}-${month}`);
  }
  return months;
}

function getYearToDate() {
  const months = [];
  const today = new Date();
  const year = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  for (let m = 0; m <= currentMonth; m++) {
    const month = String(m + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
  }
  return months;
}

function getCustomMonthRange(fromMonth, toMonth) {
  const months = [];
  const [fromYear, fromMonthNum] = fromMonth.split('-').map(Number);
  const [toYear, toMonthNum] = toMonth.split('-').map(Number);

  let currentYear = fromYear;
  let currentMonth = fromMonthNum;

  while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonthNum)) {
    const monthStr = String(currentMonth).padStart(2, '0');
    months.push(`${currentYear}-${monthStr}`);

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}

function getAllMonths(data) {
  let minDate = null;
  let maxDate = null;

  data.forEach(item => {
    item.dates.forEach(d => {
      const [year, month] = d.split('-').map(Number);
      const date = new Date(year, month - 1);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    });
  });

  const result = [];
  let current = new Date(minDate.getTime());

  while (current <= maxDate) {
    const monthStr = current.getMonth() + 1; // 1-12
    const yearStr = current.getFullYear();
    result.push(`${yearStr}-${monthStr.toString().padStart(2, '0')}`);
    current.setMonth(current.getMonth() + 1);
  }
  return result;
}

function alignData(dateArrays, amountArrays, refMonths) {
  return refMonths.map(m => {
    const idx = dateArrays.indexOf(m);
    return idx !== -1 ? amountArrays[idx] : 0;
  });
}

function formatDate(yyyymm) {
  const [year, month] = yyyymm.split('-').map(Number);
  const monthNames = [
    i18n.t('common.months.january'),
    i18n.t('common.months.february'),
    i18n.t('common.months.march'),
    i18n.t('common.months.april'),
    i18n.t('common.months.may'),
    i18n.t('common.months.june'),
    i18n.t('common.months.july'),
    i18n.t('common.months.august'),
    i18n.t('common.months.september'),
    i18n.t('common.months.october'),
    i18n.t('common.months.november'),
    i18n.t('common.months.december')
  ];
  return `${monthNames[month - 1].substring(0, 3)} ${year}`;
}

function updateMonthHeaderAll() {
  if (chartSelected !== 'currentMonth') {
    const monthHeaderAll = document.getElementById('monthHeaderAll');
    const mapRange = {
      "lastThreeMonths": i18n.t('dashboard.modal.past_3_months'),
      "lastSixMonths": i18n.t('dashboard.modal.past_6_months'),
      "lastYear": i18n.t('dashboard.modal.past_12_months'),
      "yearToDate": i18n.t('dashboard.modal.year_to_date'),
      "allData": i18n.t('dashboard.modal.to_date')
    };
    monthHeaderAll.innerText = chartSelected === 'customRange'
    ? `${formatDate(window.customRangeFrom)} - ${formatDate(window.customRangeTo)}`
    : mapRange[chartSelected];
  }
}

// ----------------
// - Transactions -
// ----------------
document.getElementById('transactionModal').addEventListener('shown.bs.modal', () => {
  document.getElementById('nameInput').focus()
});

document.getElementById('amountInput').addEventListener('input', (event) => {
  if (event.target.value.includes(',')) {
    event.target.value = event.target.value.replace(',', '.');
  }
});

async function renderTags() {
  tagsInput = new TomSelect('#tagsInput', {
    plugins: {
      remove_button: {
        title: 'Remove this tag',
      }
    },
    persist: false,
    create: true,
    render: {
      no_results: function(data, escape) {
        return '';
      },
    }
  });

  tags.forEach(tag => {
    tagsInput.addOption({ value: tag, text: tag }, user_created=false);
  });
}

async function renderNameAutocomplete() {
  nameInput = new TomSelect('#nameInput', {
    create: true,
    addPrecedence: true,
    maxOptions: 10,
    maxItems: 1,
    selectOnTab: true,
    createOnBlur: true,
    loadThrottle: 300,
    onType: function(str) {
      if (!str || str.length === 0) {
        this.clearOptions();
        this.close();
      }
    },
    load: async function(query, callback) {
      if (!query || query.length === 0) {
        this.clearOptions();
        this.close();
        return callback();
      }
      
      try {
        const response = await fetch(`${API_URL}/transactions/names/search?q=${encodeURIComponent(query)}`, {
          method: 'GET',
          credentials: 'include',
        });
        
        if (response.status === 401) {
          window.location.href = '/login';
          return callback();
        }
        
        const names = await response.json();
        const options = names.map(name => ({ value: name, text: name }));
        callback(options);
      } catch (error) {
        console.error('Error loading transaction names:', error);
        callback();
      }
    },
    render: {
      option_create: function(data, escape) {
        return '<div class="create">' + escape(data.input) + '</div>';
      },
      no_results: function(data, escape) {
        return '';
      },
    }
  });
}

async function renderCategories() {
  const select = document.getElementById('categorySelect');

  // Clear any existing options
  select.innerHTML = "";

  // First static placeholder option
  const placeholder = document.createElement('option');
  placeholder.value = "";
  placeholder.textContent = "Select category";
  placeholder.selected = true;
  placeholder.disabled = true;
  select.appendChild(placeholder);

  // Then your dynamic options
  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    option.selected = false;
    select.appendChild(option);
  });
}

function addTransaction() {
  document.getElementById('transactionForm').reset();
  document.getElementById('categorySelect').value = "";
  nameInput.clear();
  tagsInput.setValue([]);
  document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];
  document.getElementById('recurringElement').style.display = 'block';
  toggleRecurring(false);
}

function submitTransaction(event) {
  if (event.target.recurringCheck.checked) submitRecurringAdd(event);
  else submitTransactionAdd(event);
}

async function submitRecurringAdd(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  data.tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];

  // Check if startDate is before endDate
  if (new Date(data.startDate) >= new Date(data.endDate)) {
    bootstrap.showToast({body: i18n.t('transactions.messages.end_date_later'), delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
    return;
  }

  try {
    const response = await fetch(`${API_URL}/recurring`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const json = await response.json()

    if (!response.ok) {
      if (response.status === 422) throw new Error(json.detail[0].msg)
      else if ([400, 404].includes(response.status)) throw new Error(json.detail)
      throw new Error("An error occurred.")
    }
    else {
      // Hide the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('transactionModal'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('transactions.messages.recurring_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the chart
      loadChart();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

async function submitTransactionAdd(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  data.tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];

  try {
    const response = await fetch(`${API_URL}/transactions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const json = await response.json()

    if (!response.ok) {
      if (response.status === 422) throw new Error(json.detail[0].msg)
      else if ([400, 404].includes(response.status)) throw new Error(json.detail)
      throw new Error("An error occurred.")
    }
    else {
      // Hide the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('transactionModal'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('transactions.messages.transaction_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the chart
      loadChart();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

function toggleRecurring(enabled) {
  const recurringDiv = document.getElementById('recurringDiv');
  const date = document.getElementById('dateInput');
  const startDate = document.getElementById('startDateInput');
  const endDate = document.getElementById('endDateInput');
  const frequencySelect = document.getElementById('frequencySelect');

  if (enabled) {
    recurringDiv.style.display = 'block';
    date.disabled = true;
    startDate.value = new Date().toISOString().split('T')[0];
    startDate.required = true;
    endDate.required = true;
    frequencySelect.required = true;
  } else {
    recurringDiv.style.display = 'none';
    date.disabled = false;
    startDate.required = false;
    endDate.required = false;
    frequencySelect.required = false;
  }
}

// --------
// - AUTH -
// --------
async function checkLogin() {
  const response = await fetch(`${API_URL}/login/check`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const enabled = await response.json()
  if (enabled) document.getElementById('logoutButton').style.display = 'block'
}

async function logout() {
  await fetch(`${API_URL}/logout`, { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}
