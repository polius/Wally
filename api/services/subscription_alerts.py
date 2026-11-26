import logging
from datetime import date
from decimal import Decimal
from statistics import median

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models.recurring_transactions import RecurringTransaction
from ..models.subscription_alerts import SubscriptionPriceAlert
from ..models.transactions import Transaction

logger = logging.getLogger(__name__)

# Number of earlier charges used to work out the usual price
USUAL_PRICE_WINDOW = 3


def usual_price(amounts: list[Decimal]) -> Decimal | None:
    """Median of the most recent charges, so a single odd charge does not change the usual price."""
    if not amounts:
        return None
    return median(amounts[-USUAL_PRICE_WINDOW:])


def detect_price_increase(amounts: list[Decimal]) -> tuple[Decimal, Decimal] | None:
    """Return (usual price, new price) if the latest charge is a price increase.

    `amounts` are the charges of one subscription, oldest first. The latest
    charge must be above the usual price and above the charge right before it,
    so a price that has already gone up does not alert again on every charge.
    """
    if len(amounts) < 2:
        return None

    new_amount = amounts[-1]
    previous = amounts[:-1]
    usual = usual_price(previous)

    if new_amount > usual and new_amount > previous[-1]:
        return usual, new_amount
    return None


def check_subscription_price_alerts(db: Session, today: date | None = None) -> list[SubscriptionPriceAlert]:
    """Create an alert for every subscription whose latest charge went up in price.

    Only charges dated today or earlier are looked at, because future
    occurrences have not been charged yet. Returns the alerts created by this run.
    """
    today = today or date.today()
    subscriptions = db.exec(
        select(RecurringTransaction).where(
            RecurringTransaction.isSubscription == True,  # noqa: E712
            RecurringTransaction.type == "expense",
        )
    ).all()
    created = []

    for subscription in subscriptions:
        recurring_id = str(subscription.id)
        charges = db.exec(
            select(Transaction.date, Transaction.amount)
            .where(
                Transaction.recurringID == recurring_id,
                Transaction.type == "expense",
                Transaction.date <= today,
            )
            .order_by(Transaction.date)
        ).all()

        increase = detect_price_increase([Decimal(amount) for _, amount in charges])
        if not increase:
            continue

        charge_date = charges[-1][0]
        already_alerted = db.exec(
            select(SubscriptionPriceAlert.id).where(
                SubscriptionPriceAlert.recurring_id == recurring_id,
                SubscriptionPriceAlert.charge_date == charge_date,
            )
        ).first()
        if already_alerted:
            continue

        previous_amount, new_amount = increase
        alert = SubscriptionPriceAlert(
            recurring_id=recurring_id,
            name=subscription.name,
            category=subscription.category,
            frequency=subscription.frequency,
            charge_date=charge_date,
            previous_amount=previous_amount,
            new_amount=new_amount,
        )
        db.add(alert)
        created.append(alert)

    if not created:
        return []

    try:
        db.commit()
    except IntegrityError:
        # Another worker stored the same alerts first; the unique constraint keeps a single copy.
        db.rollback()
        return []

    for alert in created:
        db.refresh(alert)
    return created


def run_subscription_price_check() -> None:
    from ..database import engine

    try:
        with Session(engine) as db:
            created = check_subscription_price_alerts(db)
        if created:
            logger.info("Created %d subscription price alert(s)", len(created))
    except Exception:
        logger.exception("Subscription price check failed")
