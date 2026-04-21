const API_URL = '/api';

let currentDate = new Date();
let categories;
let tags;
let persons;
let currency;

let chart;
let chartSelected = "currentMonth";
let chartGroupBy = 'category';
let chartDisabledFields = new Set();
let budgets = {};

let tagsInput;
let nameInput;
let categoryTagsMap = {};
let previousMonthData = null; // For spending trends

let savingsChart = null;
let savingsPersonFilter = 'all'; // 'all' or a person name

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
  [categories, tags, persons, currency, budgets] = await Promise.all([
    getCategories(),
    getTags(),
    getPersons(),
    getCurrency(),
    getBudgets(),
    renderMonth(),
  ]);

  // Load chart
  await loadChart();

  // Render categories, tags, persons and name autocomplete
  await renderCategories();
  await renderTags();
  await renderPersonSelect();
  await renderNameAutocomplete();

  // Group by toggle
  setupGroupByToggle();

  // Load savings rate chart
  await loadSavingsRate();

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

async function getPersons() {
  const response = await fetch(`${API_URL}/persons`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return [];
  }

  if (!response.ok) return [];
  return response.json();
}

async function renderPersonSelect() {
  const select = document.getElementById('personSelect');
  select.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.setAttribute('data-i18n', 'transactions.bulk_none');
  none.textContent = i18n.t('transactions.bulk_none') || 'None';
  select.appendChild(none);

  persons.forEach(person => {
    const option = document.createElement('option');
    option.value = person;
    option.textContent = person;
    select.appendChild(option);
  });
}

async function getBudgets() {
  const response = await fetch(`${API_URL}/categories/budgets`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return {};
  }

  if (!response.ok) return {};
  return await response.json();
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
  buildCategoryTagsMap(transactions);
  budgets = await getBudgets();

  // Fetch previous month data for spending trends (non-blocking, runs in parallel)
  previousMonthData = null;
  let trendsPromise = null;
  if (chartSelected === 'currentMonth') {
    const prevDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
    const prevYear = prevDate.getFullYear();
    trendsPromise = fetch(`${API_URL}/transactions/date/${prevYear}-${prevMonth}`, { method: 'GET', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }

  const chartBox = document.querySelector('.chart-box');
  const legendBox = document.getElementById('customLegend');
  const cashflowSection = document.getElementById('cashflow-section');
  const noDataMessage = document.getElementById('noDataMessage');
  const trendsSection = document.getElementById('trends-section');
  const hasExpenses = transactions.some(t => t.type === 'expense');

  if (!hasExpenses) {
    chartBox.style.display = 'none';
    legendBox.style.display = 'none';
    cashflowSection.style.display = 'none';
    if (trendsSection) trendsSection.style.display = 'none';
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

    // Await trends data (was fetching in parallel) then render
    if (trendsPromise) {
      previousMonthData = await trendsPromise;
    }
    updateTrends(transactions);
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

function computeCategorySpending(transactions) {
  const map = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    map[t.category] = Decimal.add(map[t.category] || 0, t.amount).toNumber();
  });
  return map;
}

function updateTrends(currentTransactions) {
  const section = document.getElementById('trends-section');
  if (!section) return;

  // Only show trends in currentMonth view with category grouping
  if (chartSelected !== 'currentMonth' || chartGroupBy !== 'category' || !previousMonthData) {
    section.style.display = 'none';
    return;
  }

  const currSpending = computeCategorySpending(currentTransactions);
  const prevSpending = computeCategorySpending(previousMonthData);

  // Compute all category changes
  const allCategories = new Set([...Object.keys(currSpending), ...Object.keys(prevSpending)]);
  const changes = [];

  allCategories.forEach(cat => {
    const curr = currSpending[cat] || 0;
    const prev = prevSpending[cat] || 0;
    if (prev === 0 && curr === 0) return;

    const diff = Decimal.sub(curr, prev).toNumber();
    let pctChange = null;
    if (prev > 0) pctChange = ((curr - prev) / prev) * 100;

    changes.push({ category: cat, curr, prev, diff, pctChange });
  });

  // Filter out trivial changes (< 5% or both < 1)
  const significant = changes.filter(c => {
    if (c.pctChange === null) return c.curr > 0; // new category
    return Math.abs(c.pctChange) >= 5 && (c.curr > 0 || c.prev > 0);
  });

  if (significant.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Sort by absolute diff (biggest movers first)
  significant.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Take top 4
  const top = significant.slice(0, 4);

  const alertsHtml = top.map(c => {
    const arrow = c.diff > 0 ? '↑' : '↓';
    const cls = c.diff > 0 ? 'trend-alert-up' : 'trend-alert-down';

    let detail;
    let itemCls;
    if (c.pctChange === null) {
      // New category this month — use distinct "new" style
      detail = `<span class="trend-alert-pct trend-alert-new">${i18n.t('dashboard.trends.new_label') || 'new'}</span>`;
      itemCls = 'trend-alert-new';
    } else {
      detail = `<span class="trend-alert-pct ${cls}">${arrow} ${Math.abs(c.pctChange).toFixed(0)}%</span>`;
      itemCls = cls;
    }

    const diffSign = c.diff > 0 ? '+' : '';
    return `
      <div class="trend-alert-item ${itemCls}">
        <div class="trend-alert-category">${c.category}</div>
        <div class="trend-alert-values">
          ${detail}
          <span class="trend-alert-diff">${diffSign}${formatCurrency(c.diff)}</span>
        </div>
        <div class="trend-alert-compare">${formatCurrency(c.prev)} → ${formatCurrency(c.curr)}</div>
      </div>
    `;
  }).join('');

  section.innerHTML = `
    <div class="trends-header">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
      <span data-i18n="dashboard.trends.title">${i18n.t('dashboard.trends.title') || 'Spending Trends'}</span>
      <span class="trends-subtitle" data-i18n="dashboard.trends.vs_last_month">${i18n.t('dashboard.trends.vs_last_month') || 'vs last month'}</span>
    </div>
    <div class="trends-grid">${alertsHtml}</div>
  `;
  section.style.display = 'block';
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
          borderColor: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#1a1a2e' : '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements.length > 0 && chartGroupBy === 'category' ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && chartGroupBy === 'category') {
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
  const untaggedLabel = i18n.t('dashboard.group_by.untagged');

  for (const { type, amount, date, category, tags: txTags, person } of transactions) {
    if (type !== 'expense') continue;

    const monthKey = date.slice(0, 7); // YYYY-MM

    if (chartGroupBy === 'tags') {
      const groupKeys = txTags && txTags.length > 0 ? txTags : [untaggedLabel];
      for (const groupValue of groupKeys) {
        if (chartDisabledFields.has(groupValue)) continue;
        if (!breakdownMap[groupValue]) breakdownMap[groupValue] = { total: 0, months: {} };
        breakdownMap[groupValue].total = Decimal.add(breakdownMap[groupValue].total, amount).toNumber();
        breakdownMap[groupValue].months[monthKey] = Decimal.add((breakdownMap[groupValue].months[monthKey] || 0), amount).toNumber();
      }
    } else if (chartGroupBy === 'person') {
      const groupValue = person || 'Unassigned';
      if (chartDisabledFields.has(groupValue)) continue;
      if (!breakdownMap[groupValue]) breakdownMap[groupValue] = { total: 0, months: {} };
      breakdownMap[groupValue].total = Decimal.add(breakdownMap[groupValue].total, amount).toNumber();
      breakdownMap[groupValue].months[monthKey] = Decimal.add((breakdownMap[groupValue].months[monthKey] || 0), amount).toNumber();
    } else {
      const groupValue = category;
      if (chartDisabledFields.has(groupValue)) continue;
      if (!breakdownMap[groupValue]) breakdownMap[groupValue] = { total: 0, months: {} };
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

  // For tags, sum unique transaction amounts to avoid double-counting multi-tagged transactions
  const grandTotal = chartGroupBy === 'tags'
    ? transactions
        .filter(({ type, tags: txTags }) => {
          if (type !== 'expense') return false;
          const keys = txTags && txTags.length > 0 ? txTags : [untaggedLabel];
          return keys.some(k => !chartDisabledFields.has(k));
        })
        .reduce((sum, { amount }) => Decimal.add(sum, amount).toNumber(), 0)
    : result.reduce((sum, item) => Decimal.add(sum, item.total).toNumber(), 0);

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
  const untaggedLabel = i18n.t('dashboard.group_by.untagged');

  // Collect unique labels based on groupBy
  let uniqueLabels;
  if (chartGroupBy === 'tags') {
    const labelSet = new Set();
    monthExpenses.forEach(exp => {
      if (exp.tags && exp.tags.length > 0) exp.tags.forEach(t => labelSet.add(t));
      else labelSet.add(untaggedLabel);
    });
    uniqueLabels = Array.from(labelSet);
  } else if (chartGroupBy === 'person') {
    const labelSet = new Set();
    monthExpenses.forEach(exp => labelSet.add(exp.person || 'Unassigned'));
    uniqueLabels = Array.from(labelSet);
  } else {
    uniqueLabels = monthExpenses.map(exp => exp.category).filter((v, i, a) => a.indexOf(v) === i);
  }

  uniqueLabels
  .sort((a, b) => {
    const da = labelMap.get(a), db = labelMap.get(b);
    if (da && db) return db.total - da.total;
    if (da) return -1;
    if (db) return 1;
    return a.localeCompare(b);
  })
  .forEach((label, index) => {
    const itemData = labelMap.get(label);
    const color = chartColors[index % chartColors.length];
    const percentage = itemData ? ` (${itemData.percentage.toFixed(1)}%)` : '';
    const amount = itemData ? formatCurrency(itemData.total) : '';
    const spent = itemData ? itemData.total : 0;

    // Budget bar — only for category grouping in current month view
    const budget = (chartGroupBy === 'category' && chartSelected === 'currentMonth')
      ? (budgets[label] ?? null)
      : null;

    let budgetHtml = '';
    if (budget != null) {
      const pct = Math.min((spent / budget) * 100, 100);
      const isOver = spent > budget;
      const isNear = !isOver && pct >= 80;
      const barColor = isOver ? 'var(--bs-danger)' : (isNear ? 'var(--bs-warning)' : 'var(--bs-success)');
      const wrapperClass = isOver ? 'budget-over' : (isNear ? 'budget-near' : '');
      budgetHtml = `
        <div class="budget-bar-wrapper ${wrapperClass}">
          <div class="budget-progress">
            <div class="budget-progress-bar" style="width: ${pct}%; background-color: ${barColor};"></div>
          </div>
          <span class="budget-label">${formatCurrency(spent)} / ${formatCurrency(budget)}${isOver ? ' ⚠ over budget' : ''}</span>
        </div>`;
    }

    // Compute trend badge for current month view
    let trendHtml = '';
    if (chartSelected === 'currentMonth' && chartGroupBy === 'category' && previousMonthData) {
      const prevSpending = computeCategorySpending(previousMonthData);
      const prevAmount = prevSpending[label] || 0;
      if (prevAmount > 0 && spent > 0) {
        const pctChange = ((spent - prevAmount) / prevAmount) * 100;
        if (Math.abs(pctChange) >= 1) {
          const arrow = pctChange > 0 ? '↑' : '↓';
          const cls = pctChange > 0 ? 'trend-up' : 'trend-down';
          trendHtml = `<span class="trend-badge ${cls}">${arrow} ${Math.abs(pctChange).toFixed(0)}%</span>`;
        }
      } else if (prevAmount === 0 && spent > 0) {
        trendHtml = `<span class="trend-badge trend-new">${i18n.t('dashboard.trends.new_label') || 'new'}</span>`;
      }
    }

    const item = document.createElement('div');
    item.className = `legend-item${chartDisabledFields.has(label) ? ' disabled' : ''}`;
    item.innerHTML = `
    <div class="color-box" style="background-color: ${color}"></div>
    <div class="legend-text">
      <div class="legend-text-row">
        <span>${label}${percentage} ${trendHtml}</span>
        <span class="amount">${amount}</span>
      </div>
      ${budgetHtml}
    </div>
    `;
    item.addEventListener('click', () => toggleLegend(label));
    legendContainer.appendChild(item);
  });

  // Calculate active total — always the real expense sum (never inflated)
  let activeTotal;
  if (chartGroupBy === 'tags') {
    // Only count transactions whose tags are not ALL disabled
    activeTotal = monthExpenses
    .filter(tx => {
      const keys = tx.tags && tx.tags.length > 0 ? tx.tags : [untaggedLabel];
      return keys.some(t => !chartDisabledFields.has(t));
    })
    .reduce((sum, x) => Decimal.add(sum, x.amount).toNumber(), 0);
  } else if (chartGroupBy === 'person') {
    activeTotal = monthExpenses
    .filter(x => !chartDisabledFields.has(x.person || 'Unassigned'))
    .reduce((sum, x) => Decimal.add(sum, x.amount).toNumber(), 0);
  } else {
    activeTotal = monthExpenses
    .filter(x => !chartDisabledFields.has(x.category))
    .reduce((sum, x) => Decimal.add(sum, x.amount).toNumber(), 0);
  }

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

function setupGroupByToggle() {
  const buttons = document.querySelectorAll('.group-by-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartGroupBy = btn.dataset.group;
      chartDisabledFields = new Set();
      loadChart();
    });
  });
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

// -----------------
// - Savings Rate  -
// -----------------
async function loadSavingsRate() {
  const section = document.getElementById('savings-rate-section');
  if (!section) return;

  try {
    const response = await fetch(`${API_URL}/transactions/past-12-months`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) { section.style.display = 'none'; return; }
    const transactions = await response.json();

    if (!transactions || transactions.length === 0) {
      section.style.display = 'none';
      return;
    }

    // Build person filter buttons
    buildSavingsPersonFilter(transactions);

    // Render the chart
    renderSavingsChart(transactions);

    section.style.display = 'block';
  } catch (_) {
    section.style.display = 'none';
  }
}

function buildSavingsPersonFilter(transactions) {
  const container = document.getElementById('savings-person-filter');
  const personSet = new Set();
  transactions.forEach(t => { if (t.person) personSet.add(t.person); });

  // Don't show filter if only one or no persons
  if (personSet.size <= 1) {
    container.innerHTML = '';
    return;
  }

  const allLabel = i18n.t('dashboard.savings.all') || 'All';
  let html = `<button class="savings-filter-btn${savingsPersonFilter === 'all' ? ' active' : ''}" data-person="all">${allLabel}</button>`;
  Array.from(personSet).sort().forEach(person => {
    const isActive = savingsPersonFilter === person ? ' active' : '';
    html += `<button class="savings-filter-btn${isActive}" data-person="${person}">${person}</button>`;
  });
  container.innerHTML = html;

  // Event listeners
  container.querySelectorAll('.savings-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      savingsPersonFilter = btn.dataset.person;
      container.querySelectorAll('.savings-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Re-render chart with cached transactions
      loadSavingsRate();
    });
  });
}

function renderSavingsChart(transactions) {
  // Generate last 12 months labels
  const months = [];
  const today = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${d.getFullYear()}-${m}`);
  }

  // Filter by person if needed
  const filtered = savingsPersonFilter === 'all'
    ? transactions
    : transactions.filter(t => t.person === savingsPersonFilter);

  // Compute per-month income, expenses, savings rate
  const monthlyData = months.map(month => {
    const monthTx = filtered.filter(t => t.date.startsWith(month));
    const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => Decimal.add(s, t.amount).toNumber(), 0);
    const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => Decimal.add(s, t.amount).toNumber(), 0);
    const rate = income > 0 ? ((income - expenses) / income) * 100 : null;
    return { month, income, expenses, rate };
  });

  // Update summary
  updateSavingsSummary(monthlyData);

  // Destroy old chart
  if (savingsChart) savingsChart.destroy();

  const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  const zeroLineColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';

  const rates = monthlyData.map(d => d.rate);
  const hasData = rates.some(r => r !== null);

  if (!hasData) {
    document.getElementById('savings-rate-section').style.display = 'none';
    return;
  }

  savingsChart = new Chart('savingsChartCanvas', {
    type: 'line',
    data: {
      labels: months.map(m => formatDate(m)),
      datasets: [{
        label: i18n.t('dashboard.savings.rate_label') || 'Savings Rate',
        data: rates,
        fill: true,
        backgroundColor: (ctx) => {
          const chart = ctx.chart;
          const { ctx: context, chartArea } = chart;
          if (!chartArea) return 'rgba(16, 185, 129, 0.1)';
          const gradient = context.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
          gradient.addColorStop(1, 'rgba(16, 185, 129, 0.01)');
          return gradient;
        },
        borderColor: '#10b981',
        borderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: (ctx) => {
          const val = ctx.raw;
          if (val === null) return 'transparent';
          return val >= 0 ? '#10b981' : '#ef4444';
        },
        pointBorderColor: isDark ? '#1a1a2e' : '#ffffff',
        pointBorderWidth: 2,
        tension: 0.3,
        spanGaps: true,
        segment: {
          borderColor: (ctx) => {
            const val = ctx.p1.raw;
            return val !== null && val < 0 ? '#ef4444' : '#10b981';
          },
        },
      }]
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
          grid: { color: gridColor },
          ticks: { maxRotation: 45, minRotation: 0 },
        },
        y: {
          grid: { color: (ctx) => ctx.tick.value === 0 ? zeroLineColor : gridColor },
          ticks: {
            callback: (value) => `${value}%`,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 13 },
          bodySpacing: 6,
          displayColors: false,
          callbacks: {
            label: (ctx) => {
              const d = monthlyData[ctx.dataIndex];
              if (d.rate === null) return i18n.t('dashboard.savings.no_income') || 'No income';
              const lines = [
                `${i18n.t('dashboard.savings.rate_label') || 'Savings Rate'}: ${d.rate.toFixed(1)}%`,
                `${i18n.t('dashboard.cashflow.income') || 'Income'}: ${formatCurrency(d.income)}`,
                `${i18n.t('dashboard.cashflow.expenses') || 'Expenses'}: ${formatCurrency(d.expenses)}`,
                `${i18n.t('dashboard.savings.saved') || 'Saved'}: ${formatCurrency(Decimal.sub(d.income, d.expenses))}`,
              ];
              return lines;
            },
          },
        },
      },
    },
  });
}

function updateSavingsSummary(monthlyData) {
  const container = document.getElementById('savings-rate-summary');

  // Calculate overall stats from months with income
  const validMonths = monthlyData.filter(d => d.rate !== null);
  if (validMonths.length === 0) {
    container.innerHTML = '';
    return;
  }

  const avgRate = validMonths.reduce((s, d) => s + d.rate, 0) / validMonths.length;
  const totalIncome = validMonths.reduce((s, d) => Decimal.add(s, d.income).toNumber(), 0);
  const totalExpenses = validMonths.reduce((s, d) => Decimal.add(s, d.expenses).toNumber(), 0);
  const totalSaved = Decimal.sub(totalIncome, totalExpenses).toNumber();
  const currentRate = validMonths[validMonths.length - 1]?.rate;

  const rateClass = (r) => r >= 20 ? 'savings-stat-great' : r >= 0 ? 'savings-stat-ok' : 'savings-stat-negative';

  container.innerHTML = `
    <div class="savings-stat">
      <span class="savings-stat-label">${i18n.t('dashboard.savings.current') || 'Current'}</span>
      <span class="savings-stat-value ${rateClass(currentRate)}">${currentRate !== null && currentRate !== undefined ? currentRate.toFixed(1) + '%' : '—'}</span>
    </div>
    <div class="savings-stat">
      <span class="savings-stat-label">${i18n.t('dashboard.savings.average') || 'Average'}</span>
      <span class="savings-stat-value ${rateClass(avgRate)}">${avgRate.toFixed(1)}%</span>
    </div>
    <div class="savings-stat">
      <span class="savings-stat-label">${i18n.t('dashboard.savings.total_saved') || 'Total Saved'}</span>
      <span class="savings-stat-value ${totalSaved >= 0 ? 'savings-stat-great' : 'savings-stat-negative'}">${formatCurrency(totalSaved)}</span>
    </div>
  `;
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

function buildCategoryTagsMap(rows) {
  categoryTagsMap = {};
  if (!rows) return;
  rows.forEach(row => {
    if (row.category && row.tags && row.tags.length) {
      if (!categoryTagsMap[row.category]) categoryTagsMap[row.category] = {};
      row.tags.forEach(tag => {
        categoryTagsMap[row.category][tag] = (categoryTagsMap[row.category][tag] || 0) + 1;
      });
    }
  });
}

function getSuggestedTags() {
  const cat = document.getElementById('categorySelect').value;
  if (!cat || !categoryTagsMap[cat]) return [];
  return Object.keys(categoryTagsMap[cat]);
}

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
      option: function(data, escape) {
        const suggested = getSuggestedTags();
        const isSuggested = suggested.includes(data.value);
        return `<div class="${isSuggested ? 'tag-suggested' : ''}">${escape(data.text)}</div>`;
      },
    },
    score: function(search) {
      const original = this.getScoreFunction(search);
      return function(item) {
        const suggested = getSuggestedTags();
        const bonus = suggested.includes(item.value) ? 0.5 : 0;
        return original(item) + bonus;
      };
    },
  });

  function reorderTagOptions() {
    const suggested = getSuggestedTags();
    const selected = tagsInput.getValue(); // preserve current selection

    // Clear and re-add in correct order: suggested first, then the rest
    tagsInput.clearOptions();
    const suggestedTags = tags.filter(t => suggested.includes(t)).sort();
    const otherTags = tags.filter(t => !suggested.includes(t)).sort();
    suggestedTags.concat(otherTags).forEach(tag => {
      tagsInput.addOption({ value: tag, text: tag }, false);
    });

    // Restore selection
    if (selected.length) tagsInput.setValue(selected, true);

    // Refresh dropdown and apply highlight classes
    tagsInput.refreshOptions(false);
    setTimeout(() => {
      if (tagsInput.dropdown_content) {
        tagsInput.dropdown_content.querySelectorAll('.option').forEach(el => {
          const val = el.getAttribute('data-value');
          el.classList.toggle('tag-suggested', suggested.includes(val));
        });
      }
    }, 0);
  }

  tags.forEach(tag => {
    tagsInput.addOption({ value: tag, text: tag }, false);
  });

  // Refresh on category change and dropdown open
  document.getElementById('categorySelect').addEventListener('change', reorderTagOptions);
  tagsInput.on('dropdown_open', reorderTagOptions);
}

async function renderNameAutocomplete() {
  const nameCategoryMap = new Map();

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
    onItemAdd: function(value) {
      // Only auto-fill category if the selected name came from the API suggestions
      if (nameCategoryMap.has(value)) {
        const category = nameCategoryMap.get(value);
        if (category) {
          const categorySelect = document.getElementById('categorySelect');
          const categoryOptions = Array.from(categorySelect.options).map(o => o.value);
          if (categoryOptions.includes(category)) {
            categorySelect.value = category;
          }
        }
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
        
        const results = await response.json();
        results.forEach(r => nameCategoryMap.set(r.name, r.category));
        const options = results.map(r => ({ value: r.name, text: r.name }));
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
  placeholder.textContent = i18n.t('transactions.category_placeholder');
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
  document.getElementById('personSelect').value = "";
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

  // Duplicate warning: fetch the target month's transactions and check
  try {
    const [year, month] = data.date.split('-');
    const checkResp = await fetch(`${API_URL}/transactions/date/${year}-${month}`, { method: 'GET', credentials: 'include' });
    if (checkResp.ok) {
      const existing = await checkResp.json();
      const newAmount = parseFloat(data.amount);
      const newPerson = (data.person || '').toLowerCase();
      const newCategory = (data.category || '').toLowerCase();
      const hasDupe = existing.some(row =>
        parseFloat(row.amount) === newAmount &&
        (row.person || '').toLowerCase() === newPerson &&
        row.date === data.date &&
        (row.category || '').toLowerCase() === newCategory
      );
      if (hasDupe && !confirm(i18n.t('transactions.messages.duplicate_warning'))) return;
    }
  } catch (_) { /* proceed if check fails */ }

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
