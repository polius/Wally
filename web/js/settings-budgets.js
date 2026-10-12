(() => {
  function initializeBudgetSettings() {
    const form = document.getElementById('budgetCreateForm');
    if (!form) return;

    const modal = document.getElementById('budgetModalAdd');
    const badges = document.getElementById('budgetCategoryBadges');
    const categoryInput = document.getElementById('budgetCategoryInput');
    const limitInput = document.getElementById('budgetLimitInput');
    const periodInput = document.getElementById('budgetPeriodInput');
    const addButton = document.getElementById('budgetAddButton');
    const saveButton = document.getElementById('budgetSaveButton');
    const errorBox = document.getElementById('budgetFormError');
    const status = document.getElementById('budgetCardStatus');

    let saving = false;
    let availableCount = 0;

    function showError(message = '') {
      errorBox.textContent = message;
      errorBox.hidden = !message;
    }

    async function request(path, options = {}) {
      const response = await fetch(`/api${path}`, {
        ...options,
        credentials: 'include'
      });

      if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Please sign in.');
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const detail = data?.detail;
        const message = Array.isArray(detail)
          ? detail.map(item => item.msg).join('; ')
          : typeof detail === 'string'
            ? detail
            : `Request failed: HTTP ${response.status}`;

        throw new Error(message);
      }

      return data;
    }

    async function refresh() {
      addButton.disabled = true;
      saveButton.disabled = true;
      categoryInput.disabled = true;

      const [categories, budgets] = await Promise.all([
        request('/categories'),
        request('/budgets')
      ]);

      if (
        !Array.isArray(categories) ||
        !categories.every(category => typeof category === 'string') ||
        !Array.isArray(budgets)
      ) {
        throw new Error('The server returned an unexpected response.');
      }

      const budgetCategories = new Set(
        budgets.map(budget => budget.category)
      );
      const previousCategory = categoryInput.value;

      badges.replaceChildren();
      categoryInput.replaceChildren();

      const placeholder = new Option('Select a category', '');
      placeholder.disabled = true;
      placeholder.selected = true;
      categoryInput.add(placeholder);

      availableCount = 0;

      for (const category of categories) {
        const hasBudget = budgetCategories.has(category);
        const badge = document.createElement('span');

        badge.className =
          'badge rounded-pill me-2 mb-2 px-3 py-2 ' +
          (hasBudget ? 'text-bg-success' : 'text-bg-secondary');

        badge.textContent = hasBudget
          ? `${category} · Budget set`
          : category;

        badges.appendChild(badge);

        const option = new Option(
          hasBudget ? `${category} — Budget already set` : category,
          category
        );

        option.disabled = hasBudget;
        categoryInput.add(option);

        if (!hasBudget) availableCount++;
      }

      if (
        categories.includes(previousCategory) &&
        !budgetCategories.has(previousCategory)
      ) {
        categoryInput.value = previousCategory;
      }

      if (categories.length === 0) {
        badges.textContent = 'Create a category before adding a budget.';
      }

      status.textContent = categories.length === 0
        ? 'No categories available.'
        : availableCount === 0
          ? 'Every category already has a budget.'
          : '';

      categoryInput.disabled = availableCount === 0;
      addButton.disabled = saving || availableCount === 0;
      saveButton.disabled = saving || availableCount === 0;
    }

    modal.addEventListener('show.bs.modal', () => {
      form.reset();
      showError();

      refresh().catch(error => {
        showError(error.message);
      });
    });

    modal.addEventListener('hide.bs.modal', event => {
      if (saving) event.preventDefault();
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;

      const limit = Number(limitInput.value);

      if (!Number.isFinite(limit) || limit <= 0) {
        showError('Enter a budget amount greater than zero.');
        return;
      }

      saving = true;
      addButton.disabled = true;
      saveButton.disabled = true;
      showError();

      let created = false;

      try {
        await request('/budgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: categoryInput.value,
            limit: limitInput.value,
            period: periodInput.value
          })
        });

        created = true;
      } catch (error) {
        showError(error.message);
      } finally {
        saving = false;
      }

      if (created) {
        bootstrap.Modal.getOrCreateInstance(modal).hide();

        try {
          await refresh();
          status.textContent = availableCount === 0
            ? 'Budget saved. Every category now has a budget.'
            : 'Budget saved.';
        } catch (error) {
          status.textContent =
            `Budget saved, but indicators could not refresh: ${error.message}`;
        }
      } else {
        try {
          await refresh();
        } catch (error) {
          status.textContent = `Could not refresh categories: ${error.message}`;
        }
      }
    });

    refresh().catch(error => {
      badges.textContent = 'Budget information is unavailable.';
      status.textContent = error.message;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initializeBudgetSettings,
      { once: true }
    );
  } else {
    initializeBudgetSettings();
  }
})();