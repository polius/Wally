import logging
import os
from datetime import date, datetime
from decimal import Decimal

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models.app import AppConfig
from ..models.budget_alerts import BudgetAlert, DEFAULT_WARNING_THRESHOLD, OVER_BUDGET, WARNING
from ..models.budgets import Budget
from ..models.transactions import Transaction
from .budget_period import current_window

logger = logging.getLogger(__name__)

WARNING_THRESHOLD_KEY = "BUDGET_WARNING_THRESHOLD"
OVER_BUDGET_THRESHOLD = 100
JOB_ID = "budget_alert_check"


def get_warning_threshold(db: Session) -> int:
    config = db.get(AppConfig, WARNING_THRESHOLD_KEY)
    try:
        value = int(config.value)
    except (AttributeError, TypeError, ValueError):
        return DEFAULT_WARNING_THRESHOLD
    return value if 1 <= value <= 99 else DEFAULT_WARNING_THRESHOLD


def set_warning_threshold(db: Session, value: int) -> None:
    config = db.get(AppConfig, WARNING_THRESHOLD_KEY)
    if config:
        config.value = str(value)
    else:
        config = AppConfig(key=WARNING_THRESHOLD_KEY, value=str(value))
    db.add(config)
    db.commit()


def reached(spent: Decimal, limit: Decimal, percent: int) -> bool:
    # Integer math avoids float rounding at the exact threshold.
    return spent * 100 >= limit * percent


def check_budget_alerts(db: Session, today: date | None = None) -> list[BudgetAlert]:
    """Create any missing alerts for the current period of every budget.

    Each level (warning / over budget) is stored at most once per budget
    period window, so running this repeatedly never creates duplicates.
    Returns the alerts created by this run.
    """
    today = today or date.today()
    warning_threshold = get_warning_threshold(db)
    budgets = db.exec(select(Budget)).all()
    created = []

    for budget in budgets:
        window_start, window_end = current_window(budget.period, budget.start_date, today)
        amounts = db.exec(
            select(Transaction.amount).where(
                Transaction.category == budget.category,
                Transaction.type == "expense",
                Transaction.date >= window_start,
                Transaction.date <= window_end,
            )
        ).all()
        spent = sum((Decimal(amount) for amount in amounts), Decimal("0.00"))

        levels = []
        if reached(spent, budget.limit, warning_threshold):
            levels.append((WARNING, warning_threshold))
        if reached(spent, budget.limit, OVER_BUDGET_THRESHOLD):
            levels.append((OVER_BUDGET, OVER_BUDGET_THRESHOLD))
        if not levels:
            continue

        existing = set(db.exec(
            select(BudgetAlert.level).where(
                BudgetAlert.category == budget.category,
                BudgetAlert.period == budget.period,
                BudgetAlert.window_start == window_start,
            )
        ).all())

        for level, threshold in levels:
            if level in existing:
                continue
            alert = BudgetAlert(
                category=budget.category,
                period=budget.period,
                window_start=window_start,
                window_end=window_end,
                level=level,
                threshold=threshold,
                spent=spent,
                limit=budget.limit,
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


def run_budget_alert_check() -> None:
    from ..database import engine

    try:
        with Session(engine) as db:
            created = check_budget_alerts(db)
        if created:
            logger.info("Created %d budget alert(s)", len(created))
    except Exception:
        logger.exception("Budget alert check failed")


def create_scheduler(interval_minutes: float | None = None) -> BackgroundScheduler:
    if interval_minutes is None:
        interval_minutes = float(os.getenv("BUDGET_ALERT_INTERVAL_MINUTES", "1"))

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_budget_alert_check,
        "interval",
        minutes=interval_minutes,
        id=JOB_ID,
        next_run_time=datetime.now(),  # also check once right after startup
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    return scheduler
