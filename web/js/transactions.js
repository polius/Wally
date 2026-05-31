const API_URL = '/api';

let categories;
let tags;
let currency;

let gridInstance;
let gridApi;

let modalMode = 'add';
let selectedRow;

let currentDate = new Date();
let tagsInput;
let nameInput;
let activeCategoryFilter = null;

// Execute the main function when DOM has loaded
document.addEventListener('DOMContentLoaded', () => main());

async function main() {
  await checkLogin();
  await i18n.init();

  // Check for category filter in URL
  const urlParams = new URLSearchParams(window.location.search);
  const categoryParam = urlParams.get('category');
  if (categoryParam) {
    activeCategoryFilter = decodeURIComponent(categoryParam);
  }

  // Show current month
  renderMonth();

  // Get categories, tags and default currency
  [categories, tags, currency] = await Promise.all([
    getCategories(),
    getTags(),
    getCurrency(),
  ]);

  // Render categories, tags and name autocomplete
  await renderCategories();
  await renderTags();
  nameInput = document.getElementById('nameInput');
  renderNameAutocomplete();

  // Initialize the grid
  gridApi = await initGrid();

  // Show page after all translations are applied
  i18n.showPage();

  // Set Viewport Height (for mobile devices)
  window.addEventListener('load', setViewportHeight);
  window.addEventListener('resize', setViewportHeight);
  setViewportHeight();

  // Event listeners
  setupEventListeners();
}

function setViewportHeight() {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
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

  return response.json();
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

  return response.json();
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

function renderNameAutocomplete() {
  const nameCategoryMap = new Map();

  // Custom dropdown — native <datalist> popups ignore color-scheme on most
  // Chromium builds and render dark even when the page is in light mode.
  const wrapper = document.createElement('div');
  wrapper.className = 'name-autocomplete-wrapper';
  nameInput.parentNode.insertBefore(wrapper, nameInput);
  wrapper.appendChild(nameInput);

  const dropdown = document.createElement('div');
  dropdown.className = 'name-autocomplete-dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.hidden = true;
  wrapper.appendChild(dropdown);

  let currentResults = [];
  let activeIndex = -1;

  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  const applyCategoryFor = (name) => {
    const category = nameCategoryMap.get(name);
    if (!category) return;
    const categorySelect = document.getElementById('categorySelect');
    if ([...categorySelect.options].some(o => o.value === category)) {
      categorySelect.value = category;
    }
  };

  const hideDropdown = () => {
    dropdown.hidden = true;
    activeIndex = -1;
  };

  const render = () => {
    if (currentResults.length === 0) {
      hideDropdown();
      return;
    }
    dropdown.innerHTML = currentResults.map((r, i) =>
      `<div class="name-autocomplete-item${i === activeIndex ? ' active' : ''}" role="option" data-index="${i}">${escapeHtml(r.name)}</div>`
    ).join('');
    dropdown.hidden = false;
  };

  const selectIndex = (i) => {
    const item = currentResults[i];
    if (!item) return;
    nameInput.value = item.name;
    applyCategoryFor(item.name);
    hideDropdown();
  };

  let searchTimer;
  nameInput.addEventListener('input', () => {
    applyCategoryFor(nameInput.value);

    clearTimeout(searchTimer);
    const query = nameInput.value.trim();
    if (!query) {
      currentResults = [];
      hideDropdown();
      return;
    }
    searchTimer = setTimeout(async () => {
      const response = await fetch(`${API_URL}/transactions/names/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
      if (response.status === 401) return window.location.href = '/login';
      if (!response.ok) return;
      const results = await response.json();
      results.forEach(r => nameCategoryMap.set(r.name, r.category));
      currentResults = results;
      activeIndex = -1;
      render();
    }, 300);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (dropdown.hidden || currentResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentResults.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? currentResults.length - 1 : activeIndex - 1;
      render();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectIndex(activeIndex);
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  // mousedown fires before the input's blur, so the selection still applies
  dropdown.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.name-autocomplete-item');
    if (!item) return;
    e.preventDefault();
    selectIndex(parseInt(item.dataset.index, 10));
  });

  nameInput.addEventListener('blur', () => {
    setTimeout(hideDropdown, 150);
  });

  // Reset state whenever the modal closes so the dropdown doesn't reappear
  // with stale results on the next open.
  document.getElementById('transactionModal').addEventListener('hidden.bs.modal', () => {
    currentResults = [];
    hideDropdown();
  });
}

async function initGrid() {
  let myTheme;
  const theme = localStorage.getItem('theme') || 'system';
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (theme === 'light' || (theme === 'system' && !systemPrefersDark)) {
    myTheme = agGrid.themeQuartz.withPart(agGrid.colorSchemeLightWarm);
  }
  else {
    myTheme = agGrid.themeQuartz.withParams({
      backgroundColor: '#212529',
      foregroundColor: '#b5b9bd',
      headerTextColor: '#b5b9bd',
      headerBackgroundColor: '#272b30',
      oddRowBackgroundColor: '#272b30',
      headerColumnResizeHandleColor: '#b5b9bd',
    });
  }

  const gridOptions = {
    theme: myTheme,
    suppressMovableColumns: true,
    rowData: [],
    rowSelection: {
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    },
    defaultColDef: {
      flex: 1,
      minWidth: 150,
    },
    overlayNoRowsTemplate: `<span style="padding: 10px; border: 1px solid var(--bs-border-color); background: var(--bs-body-bg);">${i18n.t('common.no_rows')}</span>`,
    onGridReady: async params => {
      gridApi = params.api;
      await getTransactions();

      // Apply category filter if present from URL
      if (activeCategoryFilter) {
        applyCategoryFilter(activeCategoryFilter);
      }
    },
    onFilterChanged: params => {
      updateFooter(params.api);
    },
    onSelectionChanged: () => {
      updateDeleteButton();
    },
    columnDefs: [
      {
        width: 50,
        minWidth: 50,
        maxWidth: 50,
        suppressHeaderMenuButton: true,
        filter: false,
        resizable: false,
      },
      {
        field: "name",
        headerName: i18n.t('transactions.columns.name'),
        filter: true,
        wrapText: true,
        autoHeight: true,
        cellRenderer: (params) => {
          const container = document.createElement('span');
          const name = params.data?.name ?? '';

          const appendName = () => {
            if (name) {
              const nameSpan = document.createElement('span');
              nameSpan.textContent = name;
              container.appendChild(nameSpan);
            } else {
              // Em-dash for empty names — typographic "no value" convention,
              // disambiguates from a user-typed "-".
              const blank = document.createElement('span');
              blank.className = 'text-secondary fst-italic';
              blank.textContent = '—';
              container.appendChild(blank);
            }
          };

          if (params.data?.recurringID) {
            container.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="10" height="10" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
            <path d="M488 192l-144 0c-9.7 0-18.5-5.8-22.2-14.8s-1.7-19.3 5.2-26.2l46.7-46.7c-75.3-58.6-184.3-53.3-253.5 15.9-75 75-75 196.5 0 271.5s196.5 75 271.5 0c8.2-8.2 15.5-16.9 21.9-26.1 10.1-14.5 30.1-18 44.6-7.9s18 30.1 7.9 44.6c-8.5 12.2-18.2 23.8-29.1 34.7-100 100-262.1 100-362 0S-25 175 75 75c94.3-94.3 243.7-99.6 344.3-16.2L471 7c6.9-6.9 17.2-8.9 26.2-5.2S512 14.3 512 24l0 144c0 13.3-10.7 24-24 24z"/>
            </svg>
            `;
          }
          appendName();
          return container;
        }
      },
      {
        field: "category",
        headerName: i18n.t('transactions.columns.category'),
        filter: true,
      },
      {
        field: "tags",
        headerName: i18n.t('transactions.columns.tags'),
        filter: true,
        valueFormatter: (params) => {
          return params.value ? params.value.join(", ") : "";
        },
      },
      {
        field: "date",
        headerName: i18n.t('transactions.columns.date'),
        valueFormatter: (params) => {
          const [year, month, day] = params.value.split("-");
          const date = new Date(Number(year), Number(month) - 1, Number(day));
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
          const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const weekday = weekdayNames[date.getDay()];
          const monthName = monthNames[date.getMonth()].substring(0, 3);
          return `${weekday}, ${monthName} ${day}, ${year}`;
        }
      },
      {
        field: "amount",
        headerName: i18n.t('transactions.columns.amount'),
        valueFormatter: (params) => {
          const amount = params.value;
          const sign = params.data?.type === 'expense' ? '-' : '';

          if (currency.position === 'left') {
            return `${sign}${currency.symbol}${amount}`;
          }
          else {
            return `${sign}${amount} ${currency.symbol}`;
          }
        },
        cellClass: (params) => {
          if (params.data?.type === 'income') return 'text-green';
          if (params.data?.type === 'expense') return 'text-red';
        },
        comparator: (valueA, valueB, nodeA, nodeB, isInverted) => {
          const aData = nodeA.data;
          const bData = nodeB.data;

          // Calculate "sort value" for aData.amount based on type
          const aVal = (aData.type === 'expense' ? -aData.amount : aData.amount);
          const bVal = (bData.type === 'expense' ? -bData.amount : bData.amount);

          // Normal numeric compare
          if (aVal < bVal) return -1;
          if (aVal > bVal) return 1;
          return 0;
        }
      },
      {
        field: "actions",
        headerName: i18n.t('transactions.columns.actions'),
        width: 100,
        cellRenderer: (params) => {
          const container = document.createElement("div");
          container.className = "actions-container";

          // Edit button
          const editButton = document.createElement("button");
          editButton.className = "grid-action-btn grid-btn-edit";
          editButton.type = "button";
          editButton.title = i18n.t('common.edit');
          editButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="14" height="14" fill="currentColor">
              <path d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L368 46.1 465.9 144 490.3 119.6c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L432 177.9 334.1 80 172.4 241.7zM96 64C43 64 0 107 0 160L0 416c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7-14.3 32-32 32L96 448c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 64z"/>
            </svg>
          `;
          editButton.addEventListener("click", () => {
            selectedRow = params.data;
            editTransaction();
          });

          // Delete button
          const deleteButton = document.createElement("button");
          deleteButton.className = "grid-action-btn grid-btn-delete";
          deleteButton.type = "button";
          deleteButton.title = i18n.t('common.delete');
          deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="14" height="14" fill="currentColor">
              <path d="M136.7 5.9C141.1-7.2 153.3-16 167.1-16l113.9 0c13.8 0 26 8.8 30.4 21.9L320 32 416 32c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 8.7-26.1zM32 144l384 0 0 304c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-304zm88 64c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24z"/>
            </svg>
          `;
          deleteButton.addEventListener("click", () => {
            selectedRow = params.data;
            deleteTransaction();
          });

          container.appendChild(editButton);
          container.appendChild(deleteButton);

          return container;
        }
      }
    ]
  }

  // Destroy existing grid instance if it exists
  if (gridInstance) {
    gridInstance.destroy();
  }

  // Creating the AG Grid
  const myGridElement = document.querySelector('#myGrid');
  gridInstance = agGrid.createGrid(myGridElement, gridOptions);

  return gridInstance;
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

function onFilterTextBoxChanged() {
  gridApi.setGridOption("quickFilterText", document.getElementById("searchInput").value);
}

function applyCategoryFilter(category) {
  activeCategoryFilter = category;

  // Show filter indicator
  const indicator = document.getElementById('categoryFilterIndicator');
  indicator.style.display = 'flex';
  indicator.classList.add('d-flex');
  document.getElementById('filteredCategoryName').textContent = category;

  // Apply the filter model
  gridApi.setFilterModel({
    category: {
      filterType: 'text',
      type: 'equals',
      filter: category
    }
  });

  // Disable category column filtering
  const column = gridApi.getColumn('category');
  if (column) {
    const colDef = column.getColDef();
    colDef.filter = false;
    gridApi.refreshHeader();
  }
}

function clearCategoryFilter() {
  activeCategoryFilter = null;

  // Hide filter indicator
  const indicator = document.getElementById('categoryFilterIndicator');
  indicator.style.display = 'none';
  indicator.classList.remove('d-flex');
  document.getElementById('filteredCategoryName').textContent = '';

  // Re-enable category column filtering
  const column = gridApi.getColumn('category');
  if (column) {
    const colDef = column.getColDef();
    colDef.filter = true;
    gridApi.refreshHeader();
  }

  // Clear grid filter
  gridApi.setFilterModel(null);

  // Remove URL parameter
  const url = new URL(window.location);
  url.searchParams.delete('category');
  window.history.replaceState({}, '', url);
}

async function getTransactions() {
  const showAll = document.getElementById('showAllTransactions').checked;
  const monthHeader = document.getElementById('monthHeader');
  const monthHeaderAll = document.getElementById('monthHeaderAll');

  if (showAll) {
    monthHeader.style.display = 'none';
    monthHeaderAll.style.display = 'flex';

    // Fetch all transactions
    const response = await fetch(`${API_URL}/transactions`, {
      method: 'GET',
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json()
    gridApi.setGridOption('rowData', data)
  }
  else {
    monthHeader.style.display = 'flex';
    monthHeaderAll.style.display = 'none';

    // Fetch only current month transactions
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const year = currentDate.getFullYear(); // 2025
    const response = await fetch(`${API_URL}/transactions/date/${year}-${month}`, {
      method: 'GET',
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json()
    gridApi.setGridOption('rowData', data)
  }
  updateFooter(gridApi);
}

function setupEventListeners() {
  // Prev month button
  document.getElementById('prevMonth').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderMonth();
    getTransactions();
  });

  // Next month button
  document.getElementById('nextMonth').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderMonth();
    getTransactions();
  });

  document.getElementById('transactionModal').addEventListener('shown.bs.modal', () => {
    document.getElementById('nameInput').focus()
  });

  document.getElementById('amountInput').addEventListener('input', (event) => {
    if (event.target.value.includes(',')) {
      event.target.value = event.target.value.replace(',', '.');
    }
  });
}

function updateFooter(api) {
  const rowCount = api.getDisplayedRowCount();

  // Get total expense amount using AG Grid API
  let income = 0;
  let expense = 0;
  api.forEachNodeAfterFilterAndSort(node => {
    if (node.data.type === 'income') income = Decimal.add(income, node.data.amount).toNumber();
    else if (node.data.type === 'expense') expense = Decimal.add(expense, node.data.amount).toNumber();
  });

  if (currency.position === 'left') {
    income = `${currency.symbol}${income}`;
    expense = `${currency.symbol}${expense}`;
  }
  else {
    income = `${income} ${currency.symbol}`;
    expense = `${expense} ${currency.symbol}`;
  }

  // Update footer values
  document.getElementById('rowCount').innerText = rowCount;
  document.getElementById('incomeAmount').innerText = income;
  document.getElementById('expenseAmount').innerText = expense;
}

function addTransaction() {
  modalMode = 'add';
  document.getElementById('transactionModalLabel').textContent = i18n.t('transactions.modal_add_title');
  document.getElementById('modalSubmitButton').textContent = i18n.t('transactions.add');
  document.getElementById('transactionForm').reset();
  document.getElementById('categorySelect').value = "";
  tagsInput.setValue([]);
  document.getElementById('dateInput').value = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (Local time)
  document.getElementById('recurringElement').style.display = 'block';
  toggleRecurring(false);
}

function editTransaction() {
  modalMode = 'edit';
  document.getElementById('transactionModalLabel').textContent = i18n.t('transactions.modal_edit_title');
  document.getElementById('modalSubmitButton').textContent = i18n.t('common.update');
  document.getElementById('recurringElement').style.display = 'none';
  toggleRecurring(false);

  // Assign values
  nameInput.value = selectedRow.name;
  document.getElementById('categorySelect').value = selectedRow.category
  selectedRow.tags.forEach(tag => {
    tagsInput.addOption({ value: tag, text: tag }, user_created=true);
  });
  tagsInput.setValue(selectedRow.tags);
  document.getElementById('amountInput').value = selectedRow.amount
  document.getElementById('typeSelect').value = selectedRow.type
  document.getElementById('dateInput').value = selectedRow.date

  // Open modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transactionModal'));
  modal.show();
}

function deleteTransaction() {
  modalMode = 'delete';
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transactionModalDelete'));
  modal.show();
}

function submitTransaction(event) {
  if (modalMode === 'add') {
    if (event.target.recurringCheck.checked) submitRecurringAdd(event);
    else submitTransactionAdd(event);
  }
  else if (modalMode === 'edit') submitTransactionEdit(event);
  else if (modalMode === 'delete') submitTransactionDelete(event);
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

      // Refresh the grid
      getTransactions();
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

      // Refresh the grid
      getTransactions();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

async function submitTransactionEdit(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  data.tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];

  try {
    const response = await fetch(`${API_URL}/transactions/${selectedRow.id}`, {
      method: 'PUT',
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
      bootstrap.showToast({body: i18n.t('transactions.messages.transaction_edited'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the grid
      getTransactions();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

async function submitTransactionDelete(event) {
  event.preventDefault();

  try {
    const response = await fetch(`${API_URL}/transactions/${selectedRow.id}`, {
      method: 'DELETE',
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
    else {
      // Hide the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('transactionModalDelete'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('transactions.messages.transaction_deleted'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the grid
      getTransactions();
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
    startDate.value = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (Local time)
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

function updateDeleteButton() {
  const selectedRows = gridApi.getSelectedRows();
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  const selectedCount = document.getElementById('selectedCount');
  const container = document.getElementById('actionButtonsContainer');

  if (selectedRows.length > 0) {
    selectedCount.textContent = selectedRows.length;
    // First: compact the existing buttons
    container.classList.add('compact-buttons');
    // Then: reveal the delete button after buttons have resized
    deleteBtn.style.display = '';
    deleteBtn.classList.add('d-flex');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        deleteBtn.classList.add('show-delete');
      });
    });
  } else {
    // First: hide the delete button
    deleteBtn.classList.remove('show-delete');
    // Then: after transition, remove compact and hide fully
    setTimeout(() => {
      deleteBtn.classList.remove('d-flex');
      deleteBtn.style.display = 'none';
      container.classList.remove('compact-buttons');
    }, 250);
  }
}

function deleteSelectedTransactions() {
  const selectedRows = gridApi.getSelectedRows();
  const count = selectedRows.length;

  document.getElementById('deleteMultipleMessage').innerHTML =
    i18n.t('transactions.delete_multiple_confirm').replace('{count}', `<strong>${count}</strong>`);

  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('transactionModalDeleteMultiple'));
  modal.show();
}

async function submitTransactionDeleteMultiple(event) {
  event.preventDefault();

  const selectedRows = gridApi.getSelectedRows();
  const transactionIds = selectedRows.map(row => row.id);

  try {
    const deletePromises = transactionIds.map(id =>
    fetch(`${API_URL}/transactions/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    );

    const responses = await Promise.all(deletePromises);

    // Check if any request failed
    const failedResponse = responses.find(r => !r.ok);
    if (failedResponse) {
      if (failedResponse.status === 401) {
        window.location.href = '/login';
        return;
      }
      throw new Error("An error occurred while deleting transactions.");
    }

    // Hide the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('transactionModalDeleteMultiple'));
    modal.hide();

    // Show toast
    const count = transactionIds.length;
    bootstrap.showToast({
      body: `${count} transaction${count === 1 ? '' : 's'} deleted.`,
      delay: 1000,
      position: "top-0 start-50 translate-middle-x",
      toastClass: "text-bg-success"
    });

    // Refresh the grid
    getTransactions();
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
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
