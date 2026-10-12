const API_URL = '/api';

document.addEventListener('DOMContentLoaded', () => main());

async function main() {
    await checkLogin();
    await loadBudgetProgress();
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
    const [budgetResponse, transactionResponse] = await Promise.all([
        fetch(`${API_URL}/budgets`, {
            method: 'GET',
            credentials: 'include',
        }),

        fetch(`${API_URL}/transactions`, {
            method: 'GET',
            credentials: 'include',
        })
    ]);

    const budgets = await budgetResponse.json();
    const transactions = await transactionResponse.json();

    console.log('Budgets:', budgets);
    console.log('Transactions:', transactions);

    const budgetsContainer = document.getElementById('budgetsContainer');
    const emptyState = document.getElementById('emptyState');

    budgetsContainer.innerHTML = '';

    if (budgets.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    const today = new Date();

    budgets.forEach((budget) => {

        const matchingTransactions = transactions.filter((transaction) => {
            const [year, month] = transaction.date.split('-').map(Number);

            const sameCategory = transaction.category === budget.category;
            const isExpense = transaction.type === 'expense';

                const sameMonth =
                        year === today.getFullYear() &&
                        month === today.getMonth() + 1;

            return sameCategory && isExpense && sameMonth;
        });

        const spent = matchingTransactions.reduce((total, transaction) => {
            return total + Number(transaction.amount);
        }, 0);

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
        } else if (percentage >= 80) {
            progressClass = 'bg-warning';
        }

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

                <p class="mb-0 text-muted">
                    Period: ${budget.period}
                </p>

            </div>
        `;

        budgetsContainer.appendChild(card);
    });
}