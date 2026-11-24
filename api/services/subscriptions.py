from decimal import Decimal
from datetime import date
from dateutil.relativedelta import relativedelta


def monthly_equivalent(amount: Decimal, frequency: str) -> Decimal:
    """Convert a recurring payment into an average monthly cost."""
    if frequency == "daily":
        return amount * Decimal(365) / Decimal(12)
    if frequency == "weekly":
        return amount * Decimal(52) / Decimal(12)
    if frequency == "monthly":
        return amount
    if frequency == "quarterly":
        return amount / Decimal(3)
    if frequency == "yearly":
        return amount / Decimal(12)

    raise ValueError(f"Unsupported frequency: {frequency}")



def next_charge(start_date: date, end_date: date | None,
                frequency: str, today: date | None = None) -> date | None:
    """Find the next scheduled charge within the recurring period."""
    today = today or date.today()

    if end_date is not None and today > end_date:
        return None

    if frequency not in ("daily", "weekly", "monthly", "quarterly", "yearly"):
        raise ValueError(f"Unsupported frequency: {frequency}")

    n = 0
    current = start_date

    while current < today:
        n += 1

        if frequency == "daily":
            current = start_date + relativedelta(days=n)
        elif frequency == "weekly":
            current = start_date + relativedelta(weeks=n)
        elif frequency == "monthly":
            current = start_date + relativedelta(months=n)
        elif frequency == "quarterly":
            current = start_date + relativedelta(months=3 * n)
        else:
            current = start_date + relativedelta(years=n)

    if end_date is not None and current > end_date:
        return None

    return current



def subscription_summary(recurring_transactions, today: date | None = None):
    """Build a summary of recurring expenses marked as subscriptions."""
    today = today or date.today()
    subscriptions = []
    total = Decimal("0")

    for transaction in recurring_transactions:
        if not transaction.isSubscription or transaction.type != "expense":
            continue

        charge = next_charge(
            transaction.startDate,
            transaction.endDate,
            transaction.frequency,
            today,
        )

        if charge is None:
            continue

        monthly_cost = monthly_equivalent(
            transaction.amount, transaction.frequency
        )

        subscriptions.append({
            "name": transaction.name,
            "amount": float(transaction.amount),
            "frequency": transaction.frequency,
            "nextExpectedCharge": charge.isoformat(),
            "monthlyEquivalent": round(float(monthly_cost), 2),
        })

        total += monthly_cost

    return {
        "subscriptions": subscriptions,
        "monthlyTotal": round(float(total), 2),
    }