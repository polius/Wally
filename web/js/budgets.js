const API_URL = '/api';

document.addEventListener('DOMContentLoaded', () => main());

const ALERT_REFRESH_MS = 60 * 1000;

let warningThreshold = 80;

async function main() {
    await checkLogin();
    await loadWarningThreshold();
    await Promise.all([loadBudgetAlerts(), loadBudgetProgress()]);

    // Pick up alerts raised by the background job while the page is open
    setInterval(() => {
        loadBudgetAlerts();
        loadBudgetProgress();
    }, ALERT_REFRESH_MS);
}

async function loadWarningThreshold() {
    try {
        const response = await fetch(`${API_URL}/budget-alerts/settings`, {
            method: 'GET',
            credentials: 'include',
        });
        if (response.ok) {
            warningThreshold = (await response.json()).warning_threshold;
        }
    } catch (error) {
        console.error('Could not load the budget warning threshold', error);
    }
}

async function loadBudgetAlerts() {
    const container = document.getElementById('budgetAlertsContainer');

    let alerts;
    try {
        const response = await fetch(`${API_URL}/budget-alerts`, {
            method: 'GET',
            credentials: 'include',
        });
        if (!response.ok) return;
        alerts = await response.json();
    } catch (error) {
        console.error('Could not load budget alerts', error);
        return;
    }

    container.replaceChildren();

    alerts.forEach((alert) => {
        const overBudget = alert.level === 'over_budget';
        const spent = Number(alert.spent);
        const limit = Number(alert.limit);

        const box = document.createElement('div');
        box.className = `alert ${overBudget ? 'alert-danger' : 'alert-warning'} alert-dismissible budget-alert mb-3`;
        box.setAttribute('role', 'alert');

        const title = document.createElement('strong');
        title.textContent = overBudget
            ? `Over budget: ${alert.category}`
            : `${alert.threshold}% of budget reached: ${alert.category}`;

        const details = document.createElement('div');
        details.textContent =
            `Spent $${spent.toFixed(2)} of $${limit.toFixed(2)} ` +
            `(${alert.period}, ${alert.window_start} to ${alert.window_end}).`;

        const hint = document.createElement('div');
        hint.className = 'small';
        hint.textContent = overBudget
            ? 'You have gone over this budget. Consider stopping spending in this category.'
            : 'You are getting close to this budget. Consider slowing down.';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'btn-close';
        closeButton.setAttribute('aria-label', 'Dismiss');
        closeButton.addEventListener('click', () => dismissBudgetAlert(alert.id, box));

        box.append(title, details, hint, closeButton);
        container.appendChild(box);
    });
}

async function dismissBudgetAlert(alertId, element) {
    const response = await fetch(`${API_URL}/budget-alerts/${alertId}/dismiss`, {
        method: 'POST',
        credentials: 'include',
    });

    if (response.ok) {
        element.remove();
    }
}

async function checkLogin() {
    const response = await fetch(`${API_URL}/login/check`, {
        method: 'GET',
        credentials: 'include',
    });

    if (response.status === 401) {
        window.location.href = '/login';
        return;
    }

    const enabled = await response.json();

    if (enabled) {
        document.getElementById('logoutButton').style.display = 'block';
    }
}

async function logout() {
    await fetch(`${API_URL}/logout`, {
        method: 'POST',
        credentials: 'include'
    });

    window.location.href = '/login';
}

async function loadBudgetProgress() {
    const response = await fetch(`${API_URL}/budgets`, {
        method: 'GET',
        credentials: 'include',
    });

    const budgets = await response.json();

    const budgetsContainer = document.getElementById('budgetsContainer');
    const emptyState = document.getElementById('emptyState');

    budgetsContainer.innerHTML = '';

    if (budgets.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    budgets.forEach((budget) => {
        const spent = Number(budget.spent);
        const limit = Number(budget.limit);

        const remaining = limit - spent;
        const remainingText =
            remaining >= 0
                ? `Remaining: $${remaining.toFixed(2)}`
                : `Over budget by: $${Math.abs(remaining).toFixed(2)}`;

        const percentage =
            limit > 0
                ? (spent / limit) * 100
                : 0;

        let progressClass = 'bg-success';

        if (percentage >= 100) {
            progressClass = 'bg-danger';
        } else if (percentage >= warningThreshold) {
            progressClass = 'bg-warning';
        }

        const projected = Number(budget.projected_month_end);
        const forecastOverBudget = !Number.isNaN(projected) && projected > limit;

        const forecastText = budget.projected_month_end == null
                ? 'Forecast: not enough data yet'
                : `Forecast at end of period: $${projected.toFixed(2)}${forecastOverBudget ? ' — over budget!' : ''}`;

        const card = document.createElement('div');
        card.className = 'card mb-3';

        card.innerHTML = `
            <div class="card-body">
                <h5 class="card-title">
                    ${budget.category}
                </h5>

                <p class="mb-1">
                    Budget: $${limit.toFixed(2)}
                </p>

                <p class="mb-1">
                    Spent: $${spent.toFixed(2)}
                </p>

                <p class="mb-1">
                    ${remainingText}
                </p>

                <p class="mb-1">
                    Used: ${percentage.toFixed(1)}%
                </p>
                
                <div class="progress mb-3" style="height: 22px;">
                    <div
                        class="progress-bar ${progressClass}"
                        role="progressbar"
                        style="width: ${Math.min(percentage, 100)}%;"
                        aria-valuenow="${percentage}"
                        aria-valuemin="0"
                        aria-valuemax="100">
                        ${percentage.toFixed(1)}%
                    </div>
                </div>

                <p class="mb-1 ${forecastOverBudget ? 'text-danger' : 'text-muted'}">${forecastText}</p>

                <p class="mb-0 text-muted">
                    Period: ${budget.period}<br>
                    Window: ${budget.window_start} to ${budget.window_end}
                </p>
            </div>
        `;

        budgetsContainer.appendChild(card);
    });
}