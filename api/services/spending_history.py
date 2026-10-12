from datetime import date
from decimal import Decimal

from sqlmodel import Session, select

from ..models.transactions import Transaction


def shift_month(month_start: date, offset: int) -> date:
    month_index = (
        month_start.year * 12
        + month_start.month - 1
        + offset
    )

    year, month_zero_based = divmod(month_index, 12)

    return date(year, month_zero_based + 1, 1)


def get_spending_history(
    db: Session,
    category: str,
    today: date,
    months: int = 6,
) -> dict:
    if not 1 <= months <= 6:
        raise ValueError("months must be between 1 and 6")

    end = today.replace(day=1)
    start = shift_month(end, -months)

    statement = select(Transaction).where(
        Transaction.category == category,
        Transaction.type == "expense",
        Transaction.date >= start,
        Transaction.date < end,
    )

    transactions = db.exec(statement).all()

    totals: dict[date, Decimal] = {}

    for transaction in transactions:
        month = transaction.date.replace(day=1)

        totals[month] = (
            totals.get(month, Decimal("0.00"))
            + transaction.amount
        )

    history = []

    if totals:
        month = min(totals)

        while month < end:
            history.append({
                "month": month.strftime("%Y-%m"),
                "amount": totals.get(month, Decimal("0.00")),
            })

            month = shift_month(month, 1)

    return {
        "category": category,
        "window_start": start,
        "window_end_exclusive": end,
        "history": history,
    }