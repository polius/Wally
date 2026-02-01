const API_URL = '/api';

let categories;
let tags;
let currency;
let login;

let categorySelected;
let tagSelected;

let gridInstance;
let gridApi;

let modalMode = 'add';
let selectedRow;

let tagsInput;

// Execute the main function when DOM has loaded
document.addEventListener('DOMContentLoaded', () => main());

async function main() {
  await checkLogin();
  await getVersion();

  // Initialize i18n
  await i18n.init();
  renderLanguage();

  // Get categories, tags and default currency
  [categories, tags, currency, login] = await Promise.all([
    getCategories(),
    getTags(),
    getCurrency(),
    getLogin(),
    renderTheme(),
  ]);

  // Render Login elements
  renderLogin();

  // Initialize the grid
  gridApi = await initGrid();

  // Show page after all translations are applied
  i18n.showPage();

  // Init Tom Select for tags input
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
}

async function getVersion() {
  const response = await fetch(`${API_URL}/version`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const data = await response.json();
  document.getElementById('version').innerText = `${data.version}`;
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
  await renderCategories(data);
  return categories
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
  await renderTags(data);
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
  await renderCurrency(data);
  return {
    name: data.selected,
    symbol: data.currencies.find(c => c.name === data.selected)?.symbol,
    position: data.position
  };
}

async function getLogin() {
  const response = await fetch(`${API_URL}/login/check`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  return await response.json()
}

// --------------
// - CATEGORIES -
// --------------
document.getElementById('categoryModalEdit').addEventListener('shown.bs.modal', () => {
  document.getElementById('categoryEditInput').focus();
});

function openCategoryActionsModal(category) {
  // Store selected category
  categorySelected = category;

  // Update modal with category name
  document.getElementById('categoryModalActionsName').textContent = category;

  // Show modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModalActions'));
  modal.show();
}

function openEditCategoryModal() {
  // Hide actions modal
  const actionsModal = bootstrap.Modal.getInstance(document.getElementById('categoryModalActions'));
  actionsModal.hide();

  // Set the current name in the edit input
  document.getElementById('categoryEditInput').value = categorySelected;

  // Show edit modal
  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModalEdit'));
  editModal.show();
}

function openDeleteCategoryModal() {
  // Hide actions modal
  const actionsModal = bootstrap.Modal.getInstance(document.getElementById('categoryModalActions'));
  actionsModal.hide();

  // Update delete modal with category name
  document.getElementById('categoryModalDeleteName').textContent = categorySelected;

  // Show delete modal
  const deleteModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModalDelete'));
  deleteModal.show();
}

async function editCategorySubmit(event) {
  event.preventDefault();

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`${API_URL}/categories/${categorySelected}`, {
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('categoryModalEdit'));
      modal.hide();

      // Show toast with info about transaction updates
      bootstrap.showToast({body: i18n.t('settings.messages.category_updated'), delay: 2500, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the categories
      categories = await getCategories();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}
async function renderCategories(categories) {
  const container = document.getElementById('categoryBadges');
  container.innerHTML = ''; // clear previous badges

  if (categories.length == 0) {
    const empty = document.createElement('span');
    empty.style.fontSize = '0.9rem'
    empty.innerText = "No categories have been created yet."
    empty.style.fontStyle = 'italic';
    container.appendChild(empty);
  }
  else {
    categories.forEach(category => {
      // Create badge span
      const badge = document.createElement('span');
      badge.className = 'badge rounded-pill me-2 d-inline-flex align-items-center mb-2';
      badge.style.height = '34px';
      badge.style.paddingLeft = '12px';
      badge.style.paddingRight = '12px';
      badge.style.fontSize = '0.9rem';
      badge.style.fontWeight = '400';
      badge.style.cursor = 'pointer';
      badge.style.transition = 'opacity 0.2s ease, transform 0.1s ease';
      badge.textContent = category;

      // Add hover effect
      badge.addEventListener('mouseenter', function() {
        badge.style.opacity = '0.8';
        badge.style.transform = 'scale(1.05)';
      });
      badge.addEventListener('mouseleave', function() {
        badge.style.opacity = '1';
        badge.style.transform = 'scale(1)';
      });

      // Open actions modal on click
      badge.onclick = function() { openCategoryActionsModal(category) };

      // Append badge to container
      container.appendChild(badge);
    });
  }

  // Update the select dropdown in recurring transactions
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

async function addCategory(event) {
  event.preventDefault();

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  // Add new category
  try {
    const response = await fetch(`${API_URL}/categories`, {
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
      categories = await getCategories();
      bootstrap.showToast({body: i18n.t('settings.messages.category_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})
      document.getElementById('categoryForm').reset();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

function deleteCategory(category) {
  // Store selected category
  categorySelected = category;

  // Update delete modal with category name
  document.getElementById('categoryModalDeleteName').textContent = categorySelected;

  // Show modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModalDelete'));
  modal.show();
}

async function deleteCategorySubmit(event) {
  event.preventDefault();

  try {
    const response = await fetch(`${API_URL}/categories/${categorySelected}`, {
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('categoryModalDelete'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.category_deleted'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the categories
      categories = await getCategories();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error.message || error}`, delay: 4000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

// --------
// - TAGS -
// --------
document.getElementById('tagModalEdit').addEventListener('shown.bs.modal', () => {
  document.getElementById('tagEditInput').focus();
});

function openTagActionsModal(tag) {
  // Store selected tag
  tagSelected = tag;

  // Update modal with tag name
  document.getElementById('tagModalActionsName').textContent = tag;

  // Show modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('tagModalActions'));
  modal.show();
}

function openEditTagModal() {
  // Hide actions modal
  const actionsModal = bootstrap.Modal.getInstance(document.getElementById('tagModalActions'));
  actionsModal.hide();

  // Set the current name in the edit input
  document.getElementById('tagEditInput').value = tagSelected;

  // Show edit modal
  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('tagModalEdit'));
  editModal.show();
}

function openDeleteTagModal() {
  // Hide actions modal
  const actionsModal = bootstrap.Modal.getInstance(document.getElementById('tagModalActions'));
  actionsModal.hide();

  // Update delete modal with tag name
  document.getElementById('tagModalDeleteName').textContent = tagSelected;

  // Show delete modal
  const deleteModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('tagModalDelete'));
  deleteModal.show();
}

async function editTagSubmit(event) {
  event.preventDefault();

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`${API_URL}/tags/${tagSelected}`, {
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('tagModalEdit'));
      modal.hide();

      // Show toast with info about transaction updates
      bootstrap.showToast({body: i18n.t('settings.messages.tag_updated'), delay: 2500, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the tags
      tags = await getTags();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}
async function renderTags(tags) {
  const container = document.getElementById('tagBadges');
  container.innerHTML = ''; // clear previous badges

  if (tags.length == 0) {
    const empty = document.createElement('span');
    empty.style.fontSize = '0.9rem'
    empty.innerText = "No tags have been created yet."
    empty.style.fontStyle = 'italic';
    container.appendChild(empty);
  }
  else {
    tags.forEach(tag => {
      // Create badge span
      const badge = document.createElement('span');
      badge.className = 'badge rounded-pill me-2 d-inline-flex align-items-center mb-2';
      badge.style.height = '34px';
      badge.style.paddingLeft = '12px';
      badge.style.paddingRight = '12px';
      badge.style.fontSize = '0.9rem';
      badge.style.fontWeight = '400';
      badge.style.cursor = 'pointer';
      badge.style.transition = 'opacity 0.2s ease, transform 0.1s ease';
      badge.textContent = tag;

      // Add hover effect
      badge.addEventListener('mouseenter', function() {
        badge.style.opacity = '0.8';
        badge.style.transform = 'scale(1.05)';
      });
      badge.addEventListener('mouseleave', function() {
        badge.style.opacity = '1';
        badge.style.transform = 'scale(1)';
      });

      // Open actions modal on click
      badge.onclick = function() { openTagActionsModal(tag) };

      // Append badge to container
      container.appendChild(badge);
    });
  }
}

async function addTag(event) {
  event.preventDefault();

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`${API_URL}/tags`, {
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
      tags = await getTags();
      bootstrap.showToast({body: i18n.t('settings.messages.tag_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})
      document.getElementById('tagForm').reset();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

function deleteTag(tag) {
  // Store selected tag
  tagSelected = tag;

  // Update delete modal with tag name
  document.getElementById('tagModalDeleteName').textContent = tagSelected;

  // Show modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('tagModalDelete'));
  modal.show();
}

async function deleteTagSubmit(event) {
  event.preventDefault();

  try {
    const response = await fetch(`${API_URL}/tags/${tagSelected}`, {
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('tagModalDelete'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.tag_deleted'), delay: 1500, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the tags
      tags = await getTags();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error.message || error}`, delay: 4000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

// ------------
// - CURRENCY -
// ------------
async function renderCurrency(data) {
  const select = document.getElementById('currencySelect');

  // Clear any existing options
  select.innerHTML = "";

  // Add currency options
  data.currencies.forEach(c => {
    const option = document.createElement('option');
    option.value = c.name;
    option.textContent = `${c.name} (${c.symbol})`;
    option.selected = c.name === data.selected;
    select.appendChild(option);
  });

  // Set position radio buttons
  document.getElementById('positionLeft').checked = data.position === 'left';
  document.getElementById('positionRight').checked = data.position === 'right';

  // Update position button labels with selected currency symbol
  const selectedCurrency = data.currencies.find(c => c.name === data.selected);
  if (selectedCurrency) {
    document.getElementById('positionLeftLabel').textContent = `${selectedCurrency.symbol}100`;
    document.getElementById('positionRightLabel').textContent = `100${selectedCurrency.symbol}`;
  }
}

async function changeCurrency(event) {
  const new_currency = event.target.value

  try {
    const response = await fetch(`${API_URL}/currency/${new_currency}`, {
      method: 'PUT',
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
      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.currency_changed'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the currency
      currency = await getCurrency();

      // Update position button labels with new currency symbol
      const currencyData = await fetch(`${API_URL}/currency`, {credentials: 'include'}).then(r => r.json());
      renderCurrency(currencyData);

      // Update the grid with the new currency
      gridApi.refreshCells();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

async function changeCurrencyPosition(event) {
  const position = event.target.value

  try {
    const response = await fetch(`${API_URL}/currency/position/${position}`, {
      method: 'PUT',
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
      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.currency_position_changed'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the currency
      currency = await getCurrency();

      // Update the grid with the new currency
      gridApi.refreshCells();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

document.getElementById('currencyModal').addEventListener('shown.bs.modal', () => {
  renderCurrencyList();
  document.getElementById('currencySearch').value = '';
});

let editingCurrency = null;
let allCurrencies = [];

async function renderCurrencyList() {
  const response = await fetch(`${API_URL}/currency`, {credentials: 'include'});
  const data = await response.json();
  allCurrencies = data;
  filterCurrencyList();
}

function filterCurrencyList() {
  const search = document.getElementById('currencySearch').value.toLowerCase();
  const tbody = document.getElementById('currencyTableBody');
  tbody.innerHTML = '';

  const filtered = allCurrencies.currencies.filter(c =>
  c.name.toLowerCase().includes(search) || c.symbol.toLowerCase().includes(search)
  );

  filtered.forEach(c => {
    const row = document.createElement('tr');
    const isSelected = c.name === allCurrencies.selected;
    if (isSelected) {
      row.style.backgroundColor = 'var(--bs-primary-bg-subtle)';
    }

    const nameCell = document.createElement('td');
    nameCell.innerHTML = `<strong>${c.name}</strong>`;

    const symbolCell = document.createElement('td');
    symbolCell.textContent = c.symbol;

    const actionsCell = document.createElement('td');
    actionsCell.style.textAlign = 'center';
    actionsCell.style.whiteSpace = 'nowrap';

    // Edit button
    const editButton = document.createElement('span');
    editButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16" fill="currentColor" style="display: inline-block; vertical-align: middle;">
    <path d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L368 46.1 465.9 144 490.3 119.6c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L432 177.9 334.1 80 172.4 241.7zM96 64C43 64 0 107 0 160L0 416c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7-14.3 32-32 32L96 448c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 64z"/>
    </svg>
    `;
    editButton.style.display = "inline-flex";
    editButton.style.justifyContent = "center";
    editButton.style.alignItems = "center";
    editButton.style.minHeight = "44px";
    editButton.style.minWidth = "44px";
    editButton.style.paddingLeft = "8px";
    editButton.style.paddingRight = "8px";
    editButton.style.borderRadius = "6px";
    editButton.style.cursor = "pointer";
    editButton.style.color = "#3d8bfd";
    editButton.style.transition = "all 0.2s ease";
    editButton.style.backgroundColor = "transparent";
    editButton.title = i18n.t('settings.currency.edit_tooltip');
    editButton.addEventListener("mouseenter", () => {
      editButton.style.color = "#0d6efd";
      editButton.style.backgroundColor = "rgba(13, 110, 253, 0.15)";
    });
    editButton.addEventListener("mouseleave", () => {
      editButton.style.color = "#3d8bfd";
      editButton.style.backgroundColor = "transparent";
    });
    editButton.addEventListener("click", () => {
      editCurrency(c.name, c.symbol);
    });

    // Delete button
    const deleteButton = document.createElement('span');
    deleteButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="15" height="15" fill="currentColor" style="display: inline-block; vertical-align: middle;">
    <path d="M135.2 17.7L128 32 32 32C14.3 32 0 46.3 0 64S14.3 96 32 96l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0-7.2-14.3C307.4 6.8 296.3 0 284.2 0L163.8 0c-12.1 0-23.2 6.8-28.6 17.7zM416 128L32 128 53.2 467c1.6 25.3 22.6 45 47.9 45l245.8 0c25.3 0 46.3-19.7 47.9-45L416 128z"/>
    </svg>
    `;
    deleteButton.style.display = "inline-flex";
    deleteButton.style.justifyContent = "center";
    deleteButton.style.alignItems = "center";
    deleteButton.style.minHeight = "44px";
    deleteButton.style.minWidth = "44px";
    deleteButton.style.paddingLeft = "8px";
    deleteButton.style.paddingRight = "8px";
    deleteButton.style.borderRadius = "6px";
    deleteButton.style.cursor = isSelected ? "not-allowed" : "pointer";
    deleteButton.style.color = isSelected ? "#adb5bd" : "#e35d6a";
    deleteButton.style.transition = "all 0.2s ease";
    deleteButton.style.backgroundColor = "transparent";
    deleteButton.style.opacity = isSelected ? "0.4" : "1";
    deleteButton.title = isSelected ? i18n.t('settings.currency.cannot_delete') : i18n.t('settings.currency.delete_tooltip');

    if (!isSelected) {
      deleteButton.addEventListener("mouseenter", () => {
        deleteButton.style.color = "#dc3545";
        deleteButton.style.backgroundColor = "rgba(220, 53, 69, 0.15)";
      });
      deleteButton.addEventListener("mouseleave", () => {
        deleteButton.style.color = "#e35d6a";
        deleteButton.style.backgroundColor = "transparent";
      });
      deleteButton.addEventListener("click", () => {
        deleteCurrency(c.name);
      });
    }

    actionsCell.appendChild(editButton);
    actionsCell.appendChild(deleteButton);

    row.appendChild(nameCell);
    row.appendChild(symbolCell);
    row.appendChild(actionsCell);

    tbody.appendChild(row);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">No currencies found</td></tr>';
  }
}

async function addCurrencySubmit(event) {
  event.preventDefault();
  const form = event.target;
  const data = {name: form.name.value.toUpperCase(), symbol: form.symbol.value};

  try {
    const response = await fetch(`${API_URL}/currency`, {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });

    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || 'Error adding currency');

    bootstrap.showToast({body: i18n.t('settings.messages.currency_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"});
    form.reset();
    await renderCurrencyList();
    currency = await getCurrency();
    renderCurrency(await fetch(`${API_URL}/currency`, {credentials: 'include'}).then(r => r.json()));
  } catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
  }
}

function editCurrency(name, symbol) {
  editingCurrency = name;
  document.getElementById('currencyEditName').value = name;
  document.getElementById('currencyEditSymbol').value = symbol;
  bootstrap.Modal.getInstance(document.getElementById('currencyModal')).hide();
  new bootstrap.Modal(document.getElementById('currencyEditModal')).show();
}

function cancelCurrencyEdit() {
  bootstrap.Modal.getInstance(document.getElementById('currencyEditModal')).hide();
  new bootstrap.Modal(document.getElementById('currencyModal')).show();
}

async function editCurrencySubmit(event) {
  event.preventDefault();
  const form = event.target;
  const data = {name: form.name.value.toUpperCase(), symbol: form.symbol.value};

  try {
    const response = await fetch(`${API_URL}/currency/${editingCurrency}/update`, {
      method: 'PUT',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });

    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || 'Error updating currency');

    bootstrap.showToast({body: i18n.t('settings.messages.currency_updated'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"});
    bootstrap.Modal.getInstance(document.getElementById('currencyEditModal')).hide();
    new bootstrap.Modal(document.getElementById('currencyModal')).show();
    await renderCurrencyList();
    currency = await getCurrency();
    renderCurrency(await fetch(`${API_URL}/currency`, {credentials: 'include'}).then(r => r.json()));
    gridApi.refreshCells();
  } catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
  }
}

async function deleteCurrency(name) {
  if (!confirm(i18n.t('settings.messages.delete_currency_confirm').replace('{name}', name))) return;

  try {
    const response = await fetch(`${API_URL}/currency/${name}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || 'Error deleting currency');

    bootstrap.showToast({body: i18n.t('settings.messages.currency_deleted'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"});
    renderCurrencyList();
    currency = await getCurrency();
    renderCurrency(await fetch(`${API_URL}/currency`, {credentials: 'include'}).then(r => r.json()));
    gridApi.refreshCells();
  } catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
  }
}

// ---------
// - THEME -
// ---------
async function renderTheme() {
  const currentTheme = localStorage.getItem('theme') || 'system';
  const select = document.getElementById('themeSelect');
  select.value = currentTheme;
}

async function changeTheme(event) {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const select = document.getElementById('themeSelect');
  const theme = event.target.value

  // Store the selected theme in localStorage
  localStorage.setItem('theme', theme);

  // Apply the theme to bootstrap elements
  if (theme === 'light' || (theme === 'system' && !systemPrefersDark)) {
    document.documentElement.setAttribute('data-bs-theme', 'light');
  }
  else {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
  }

  // Recreate the AG Grid with the new theme
  initGrid();

  // Show confirmation message
  bootstrap.showToast({body: i18n.t('settings.messages.theme_changed'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})
}

// ------------
// - LANGUAGE -
// ------------
function renderLanguage() {
  const select = document.getElementById('languageSelect');
  select.value = i18n.locale;
}

async function changeLanguage(event) {
  const lang = event.target.value;
  await i18n.setLanguage(lang);

  // Reinitialize the grid with translated column headers
  initGrid();

  bootstrap.showToast({body: i18n.t('settings.messages.language_changed'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"});
}

// --------------
// - LOGIN PAGE -
// --------------
document.getElementById('loginModalEnable').addEventListener('shown.bs.modal', () => {
  document.getElementById('loginEnablePasswordInput').focus();
  loginEnablePasswordShow.style.display = 'block';
  loginEnablePasswordHide.style.display = 'none';
  loginEnablePasswordInput.type = 'password'
});
document.getElementById('loginModalChange').addEventListener('shown.bs.modal', () => {
  document.getElementById('loginChangePasswordInput').focus();
  loginChangePasswordShow.style.display = 'block';
  loginChangePasswordHide.style.display = 'none';
  loginChangePasswordInput.type = 'password'
});

function enableLogin() {
  document.getElementById('loginFormEnable').reset();
}
function changeLogin() {
  document.getElementById('loginFormChange').reset();
}

function renderLogin() {
  const loginEnableBtn = document.getElementById('loginEnableBtn')
  const loginDisableBtn = document.getElementById('loginDisableBtn')
  const loginChangeBtn = document.getElementById('loginChangeBtn')

  if (login) {
    loginEnableBtn.style.display = 'none'
    loginDisableBtn.style.display = 'inline'
    loginChangeBtn.style.display = 'inline'
  }
  else {
    loginEnableBtn.style.display = 'inline'
    loginDisableBtn.style.display = 'none'
    loginChangeBtn.style.display = 'none'
  }
}

async function loginSubmit(event, mode) {
  event.preventDefault();

  let data = {"password": ""};
  if (mode != 'disable') {
    const formData = new FormData(event.target);
    data = Object.fromEntries(formData.entries());
  }

  // Enable login and change password
  try {
    const response = await fetch(`${API_URL}/login/password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (response.status === 405) {
      bootstrap.showToast({body: i18n.t('settings.messages.demo_action_unavailable'), delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
      return;
    }

    const json = await response.json()

    if (!response.ok) {
      if (response.status === 422) throw new Error(json.detail[0].msg)
      else if ([400, 404].includes(response.status)) throw new Error(json.detail)
      throw new Error("An error occurred.")
    }
    else {
      let modalID;
      let message;

      if (mode == 'enable') {
        modalID = 'loginModalEnable'
        message = i18n.t('settings.messages.login_enabled')
        login = true
      }
      else if (mode == 'disable') {
        modalID = 'loginModalDisable'
        message = i18n.t('settings.messages.login_disabled')
        login = false
      }
      else if (mode == 'change') {
        modalID = 'loginModalChange'
        message = i18n.t('settings.messages.password_changed')
      }

      // If mode is enable, login automatically
      if (mode == 'enable') {
        await fetch(`${API_URL}/login`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        document.getElementById('logoutButton').style.display = 'block'
      }

      // If mode is disable, logout automatically
      else if (mode == 'disable') {
        await fetch(`${API_URL}/logout`, { method: 'POST', credentials: 'include' });
        document.getElementById('logoutButton').style.display = 'none'
      }

      // Hide the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById(modalID));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: message, delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh UX
      renderLogin();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

// -------------------
// - IMPORT / EXPORT -
// -------------------
async function exportToCSV() {
  try {
    const response = await fetch(`${API_URL}/transactions`, {
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
    else {
      if (!json.length) {
        bootstrap.showToast({body: i18n.t('settings.messages.no_transactions'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
        return;
      }

      // Generate CSV only with mandatory columns
      const mandatoryColumns = ["name", "category", "tags", "amount", "type", "date"];
      const csv = Papa.unparse(json, {
        columns: mandatoryColumns
      });

      // Create Blob and trigger download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'transactions.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

async function importFromCSV() {
  const file = event.target.files[0];
  if (!file) return;

  // Read file content
  const csvText = await file.text();

  // Parse CSV to JSON using PapaParse
  const { data, errors, meta } = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transform: (value, column) => {
      if (column === "tags") return value && value.trim() !== "" ? value.split(",").map(tag => tag.trim()) : [];
      return value;
    }
  });

  // Check for missing mandatory columns
  const mandatoryColumns = ["name", "category", "tags", "amount", "type", "date"];
  const missing = mandatoryColumns.filter(col => !meta.fields.includes(col));
  if (missing.length > 0) {
    errors.unshift({message: `Missing CSV columns: ${missing.join(", ")}`});
  }

  if (errors.length) {
    bootstrap.showToast({body: errors[0].message, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
    return;
  }

  // Send data
  try {
    const response = await fetch(`${API_URL}/transactions/import`, {
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
      // Show confirmation message
      bootstrap.showToast({body: i18n.t('settings.messages.transactions_imported'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}

// --------------------------
// - RECURRING TRANSACTIONS -
// --------------------------
document.getElementById('recurringModal').addEventListener('shown.bs.modal', () => {
  document.getElementById('nameInput').focus()
});

document.getElementById('amountInput').addEventListener('input', (event) => {
  if (event.target.value.includes(',')) {
    event.target.value = event.target.value.replace(',', '.');
  }
});

async function getRecurring() {
  const response = await fetch(`${API_URL}/recurring`, {
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
    defaultColDef: {
      flex: 1,
      minWidth: 150,
    },
    overlayNoRowsTemplate: `<span style="padding: 10px; border: 1px solid var(--bs-border-color); background: var(--bs-body-bg);">${i18n.t('common.no_recurring_transactions')}</span>`,
    onGridReady: params => {
      gridApi = params.api;
      getRecurring();
    },
    onFilterChanged: params => {
      updateRowCount(params.api);
    },
    columnDefs: [
      {
        field: "name",
        headerName: i18n.t('settings.recurring.columns.name'),
        filter: true,
        wrapText: true,
        autoHeight: true,
        cellRenderer: (params) => {
          const container = document.createElement('span');

          if (params.data?.recurringID) {
            // SVG icon
            container.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="10" height="10" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
            <path d="M488 192l-144 0c-9.7 0-18.5-5.8-22.2-14.8s-1.7-19.3 5.2-26.2l46.7-46.7c-75.3-58.6-184.3-53.3-253.5 15.9-75 75-75 196.5 0 271.5s196.5 75 271.5 0c8.2-8.2 15.5-16.9 21.9-26.1 10.1-14.5 30.1-18 44.6-7.9s18 30.1 7.9 44.6c-8.5 12.2-18.2 23.8-29.1 34.7-100 100-262.1 100-362 0S-25 175 75 75c94.3-94.3 243.7-99.6 344.3-16.2L471 7c6.9-6.9 17.2-8.9 26.2-5.2S512 14.3 512 24l0 144c0 13.3-10.7 24-24 24z"/>
            </svg>
            `;
            // Add the name text after the SVG
            const nameSpan = document.createElement('span');
            nameSpan.textContent = params.data?.name;
            container.appendChild(nameSpan);
          } else {
            // Just the name if no recurringID
            container.textContent = params.data?.name;
          }
          return container;
        }
      },
      {
        field: "category",
        headerName: i18n.t('settings.recurring.columns.category'),
        filter: true,
      },
      {
        field: "tags",
        headerName: i18n.t('settings.recurring.columns.tags'),
        filter: true,
        valueFormatter: (params) => {
          return params.value ? params.value.join(", ") : "";
        },
      },
      {
        field: "startDate",
        headerName: i18n.t('settings.recurring.columns.start_date'),
        filter: true,
      },
      {
        field: "endDate",
        headerName: i18n.t('settings.recurring.columns.end_date'),
        filter: true,
      },
      {
        field: "frequency",
        headerName: i18n.t('settings.recurring.columns.frequency'),
        filter: true,
        valueFormatter: (params) => {
          return params.value ? params.value.charAt(0).toUpperCase() + params.value.slice(1) : "";
        },
      },
      {
        field: "amount",
        headerName: i18n.t('settings.recurring.columns.amount'),
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
        headerName: i18n.t('settings.recurring.columns.actions'),
        width: 100,
        cellRenderer: (params) => {
          const container = document.createElement("div");
          container.style.display = "flex";
          container.style.alignItems = "center";

          // Edit button
          const editButton = document.createElement("span");
          editButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16.5" height="16.5" fill="currentColor" style="display: inline-block; vertical-align: middle;">
          <path d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L368 46.1 465.9 144 490.3 119.6c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L432 177.9 334.1 80 172.4 241.7zM96 64C43 64 0 107 0 160L0 416c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-96c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7-14.3 32-32 32L96 448c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L96 64z"/>
          </svg>
          `;
          editButton.style.display = "flex";
          editButton.style.justifyContent = "center";
          editButton.style.alignItems = "center";
          editButton.style.width = "35px";
          editButton.style.height = "35px";
          editButton.style.borderRadius = "50%";
          editButton.style.cursor = "pointer";
          editButton.style.marginRight = "1px";
          editButton.style.color = "#007AFF"; // black
          editButton.style.transition = "color 0.3s ease, background-color 0.3s ease";
          editButton.style.backgroundColor = "transparent";
          editButton.style.lineHeight = "0";
          editButton.style.filter = "opacity(0.8)";
          editButton.title = "Edit Recurring Transaction";

          editButton.addEventListener("mouseenter", () => {
            editButton.style.color = "#0051CC";
            editButton.style.backgroundColor = "#cce4ff";
          });
          editButton.addEventListener("mouseleave", () => {
            editButton.style.color = "#007AFF" // "black";
            editButton.style.backgroundColor = "transparent";
          });
          editButton.addEventListener("click", () => {
            selectedRow = params.data;
            editRecurring()
          });

          // Delete button
          const deleteButton = document.createElement("span");
          deleteButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="16" height="16" fill="currentColor" style="display: inline-block; vertical-align: middle;">
          <path d="M136.7 5.9C141.1-7.2 153.3-16 167.1-16l113.9 0c13.8 0 26 8.8 30.4 21.9L320 32 416 32c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 8.7-26.1zM32 144l384 0 0 304c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-304zm88 64c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24z"/>
          </svg>
          `;
          deleteButton.style.display = "flex";
          deleteButton.style.justifyContent = "center";
          deleteButton.style.alignItems = "center";
          deleteButton.style.width = "35px";
          deleteButton.style.height = "35px";
          deleteButton.style.borderRadius = "50%";
          deleteButton.style.cursor = "pointer";
          deleteButton.style.marginLeft = "1px";
          deleteButton.style.color = "#FF3B30" // "black";
          deleteButton.style.transition = "color 0.3s ease, background-color 0.3s ease";
          deleteButton.style.backgroundColor = "transparent";
          deleteButton.style.lineHeight = "0";
          deleteButton.style.filter = "opacity(0.8)";
          deleteButton.title = "Delete Recurring Transaction";

          deleteButton.addEventListener("mouseenter", () => {
            deleteButton.style.color = "red";
            deleteButton.style.backgroundColor = "#ffc9c9";
          });
          deleteButton.addEventListener("mouseleave", () => {
            deleteButton.style.color = "#FF3B30" // "black";
            deleteButton.style.backgroundColor = "transparent";
          });
          deleteButton.addEventListener("click", () => {
            selectedRow = params.data;
            deleteRecurring()
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
}

function updateRowCount(api) {
  const rowCount = api.getDisplayedRowCount();
  document.getElementById('rowCount').innerText = `Rows shown: ${rowCount}`;
}

function onFilterTextBoxChanged() {
  gridApi.setGridOption("quickFilterText", document.getElementById("searchInput").value);
}

function addRecurring() {
  modalMode = 'add';
  document.getElementById('recurringModalLabel').textContent = i18n.t('settings.recurring.modal_add_title');
  document.getElementById('modalSubmitButton').textContent = i18n.t('settings.recurring.add_btn');
  document.getElementById('recurringForm').reset();
  document.getElementById('categorySelect').value = "";
  document.getElementById('frequencySelect').value = "";
  tagsInput.clearOptions();
  tags.forEach(tag => {
    tagsInput.addOption({ value: tag, text: tag }, user_created=false);
  });
  tagsInput.setValue([]);
  document.getElementById('startDateInput').value = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD (Local time)
  document.getElementById('startDateInput').disabled = false;
  document.getElementById('recurringModalApplyTo').style.display = 'none';
}

function editRecurring() {
  modalMode = 'edit';
  document.getElementById('recurringModalLabel').textContent = i18n.t('settings.recurring.modal_edit_title');
  document.getElementById('modalSubmitButton').textContent = i18n.t('settings.recurring.update_btn');

  // Assign values
  document.getElementById('nameInput').value = selectedRow.name
  document.getElementById('categorySelect').value = selectedRow.category
  tagsInput.clearOptions();
  selectedRow.tags.forEach(tag => {
    tagsInput.addOption({ value: tag, text: tag }, user_created=true);
  });
  tagsInput.setValue(selectedRow.tags);
  document.getElementById('amountInput').value = selectedRow.amount
  document.getElementById('typeSelect').value = selectedRow.type
  document.getElementById('startDateInput').value = selectedRow.startDate
  document.getElementById('startDateInput').disabled = true;
  document.getElementById('endDateInput').value = selectedRow.endDate
  document.getElementById('frequencySelect').value = selectedRow.frequency
  document.getElementById('recurringModalApplyTo').style.display = 'block';
  document.getElementById('recurringEditRadioFuture').checked = true;
  document.getElementById('recurringEditRadioAll').checked = false;

  // Open modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recurringModal'));
  modal.show();
}

function deleteRecurring() {
  modalMode = 'delete';
  document.getElementById('recurringDeleteRadioFuture').checked = true;
  document.getElementById('recurringDeleteRadioAll').checked = false;

  // Open modal
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recurringModalDelete'));
  modal.show();
}

function submitRecurring(event) {
  if (modalMode === 'add') submitRecurringAdd(event);
  else if (modalMode === 'edit') submitRecurringEdit(event);
  else if (modalMode === 'delete') submitRecurringDelete(event);
}

async function submitRecurringAdd(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  data.tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];

  // Check if start date is before end date
  if (new Date(data.startDate) >= new Date(data.endDate)) {
    bootstrap.showToast({body: i18n.t('settings.messages.end_date_later'), delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
    return;
  }

  // Check: end date cannot be more than 100 years after start date
  const yearDiff = new Date(data.endDate).getFullYear() - new Date(data.startDate).getFullYear();
  if (yearDiff > 100) {
    bootstrap.showToast({body: i18n.t('settings.messages.end_date_max_years'), delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('recurringModal'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.recurring_added'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the grid
      getRecurring();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}
async function submitRecurringEdit(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  data.tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];

  // Check if startDate is before endDate
  if (new Date(data.startDate) >= new Date(data.endDate)) {
    bootstrap.showToast({body: i18n.t('settings.messages.end_date_later'), delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"});
    return;
  }

  try {
    const response = await fetch(`${API_URL}/recurring/${selectedRow.id}`, {
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('recurringModal'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.recurring_edited'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the grid
      getRecurring();
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 3000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}
async function submitRecurringDelete(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`${API_URL}/recurring/${selectedRow.id}`, {
      method: 'DELETE',
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
      const modal = bootstrap.Modal.getInstance(document.getElementById('recurringModalDelete'));
      modal.hide();

      // Show toast
      bootstrap.showToast({body: i18n.t('settings.messages.recurring_deleted'), delay: 1000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-success"})

      // Refresh the grid
      getRecurring();
    }
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
