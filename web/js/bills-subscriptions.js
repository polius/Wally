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

async function loadSubscriptionAlerts() {
    const container = document.getElementById("subscriptionAlertsContainer");

    let alerts;
    try {
        const response = await fetch(`${API_URL}/subscription-alerts`, {
            credentials: "include"
        });
        if (!response.ok) return;
        alerts = await response.json();
    } catch (error) {
        console.error("Could not load subscription alerts", error);
        return;
    }

    container.replaceChildren();

    alerts.forEach(alert => {
        const previousAmount = Number(alert.previous_amount);
        const newAmount = Number(alert.new_amount);
        const difference = newAmount - previousAmount;

        const box = document.createElement("div");
        box.className = "alert alert-warning alert-dismissible mb-3";
        box.setAttribute("role", "alert");

        const title = document.createElement("strong");
        title.className = "d-block";
        title.textContent = `Price increase: ${alert.name}`;

        const details = document.createElement("div");
        details.textContent =
            `Usual price $${previousAmount.toFixed(2)} → new price $${newAmount.toFixed(2)} ` +
            `(+$${difference.toFixed(2)}, ${alert.frequency}, charged on ${alert.charge_date}).`;

        const hint = document.createElement("div");
        hint.className = "small";
        hint.textContent = "Review this subscription or cancel it if it is no longer worth the price.";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "btn-close";
        closeButton.setAttribute("aria-label", "Dismiss");
        closeButton.addEventListener("click", () => dismissSubscriptionAlert(alert.id, box));

        box.append(title, details, hint, closeButton);
        container.appendChild(box);
    });
}

async function dismissSubscriptionAlert(alertId, element) {
    const response = await fetch(`${API_URL}/subscription-alerts/${alertId}/dismiss`, {
        method: "POST",
        credentials: "include"
    });

    if (response.ok) {
        element.remove();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadSubscriptions();
    loadSubscriptionAlerts();

    // Pick up alerts raised by the background job while the page is open
    setInterval(loadSubscriptionAlerts, 60 * 1000);
});
