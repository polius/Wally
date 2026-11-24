const API_URL = '/api';
async function loadSubscriptions() {
    const container = document.getElementById("subscriptionsContainer");
    const emptyState = document.getElementById("subscriptionsEmpty");
    const monthlyTotal = document.getElementById("monthlyTotal");

    try {
        const response = await fetch(`${API_URL}/subscriptions/summary`, {
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error("Failed to load subscriptions");
        }

        const data = await response.json();

        monthlyTotal.textContent = `$${data.monthlyTotal.toFixed(2)}`;
        container.replaceChildren();

        if (data.subscriptions.length === 0) {
            emptyState.style.display = "block";
            return;
        }

        emptyState.style.display = "none";

        data.subscriptions.forEach(subscription => {
            const card = document.createElement("div");
            card.className = "card mb-3";

            const body = document.createElement("div");
            body.className = "card-body";

            const name = document.createElement("h5");
            name.className = "card-title";
            name.textContent = subscription.name;

            const amount = document.createElement("p");
            amount.className = "mb-1";
            amount.textContent =
                `$${subscription.amount.toFixed(2)} / ${subscription.frequency}`;

            const nextCharge = document.createElement("p");
            nextCharge.className = "text-muted mb-1";
            nextCharge.textContent =
                `Next charge: ${subscription.nextExpectedCharge}`;

            const monthlyCost = document.createElement("p");
            monthlyCost.className = "mb-0";
            monthlyCost.textContent =
                `Monthly equivalent: $${subscription.monthlyEquivalent.toFixed(2)}`;

            body.append(name, amount, nextCharge, monthlyCost);
            card.appendChild(body);
            container.appendChild(card);
        });

    } catch (error) {
        console.error(error);
        container.textContent = "Unable to load subscriptions. Please try again.";
    }
}

document.addEventListener("DOMContentLoaded", loadSubscriptions);
