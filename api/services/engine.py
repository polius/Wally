"""The recurring engine: rules become transactions on the server, once per rule and date."""
import asyncio
import logging
from datetime import date, datetime, timedelta
from dateutil.relativedelta import relativedelta
from sqlmodel import Session, select

from ..models.recurring_transactions import RecurringTransaction
from ..models.transactions import Transaction
from ..util import today as household_today, household_tz

log = logging.getLogger("wally")

MAX_STEPS = 100_000

def occurrence(rule: RecurringTransaction, n: int) -> date:
    """The nth date of a rule, counted from its start so the day never drifts.

    Days 29 to 31 fall on the last day of shorter months, and 29 February on 28 February,
    then return to the original day when the month has it.
    """
    start, step = rule.startDate, n * (rule.interval or 1)
    if rule.frequency == "daily":
        return start + timedelta(days=step)
    if rule.frequency == "weekly":
        return start + timedelta(weeks=step)
    current = start + (relativedelta(months=step) if rule.frequency == "monthly" else relativedelta(years=step))
    if rule.anchor_day and rule.anchor_day > current.day:
        last_day = (current.replace(day=1) + relativedelta(months=1) - timedelta(days=1)).day
        current = current.replace(day=min(rule.anchor_day, last_day))
    return current

def dates_between(rule: RecurringTransaction, after: date | None, until: date) -> list[date]:
    """Dates of the rule strictly after `after` (or from the start) up to `until`, inclusive."""
    last = until if rule.endDate is None else min(until, rule.endDate)
    out = []
    for n in range(MAX_STEPS):
        current = occurrence(rule, n)
        if current > last:
            break
        if after is None or current > after:
            out.append(current)
    return out

def next_date(rule: RecurringTransaction, after: date) -> date | None:
    for n in range(MAX_STEPS):
        current = occurrence(rule, n)
        if rule.endDate is not None and current > rule.endDate:
            return None
        if current > after:
            return current
    return None

def make_transaction(rule: RecurringTransaction, on: date) -> Transaction:
    return Transaction(
        name=rule.name,
        category=rule.category,
        tags=list(rule.tags or []),
        amount=rule.amount,
        type=rule.type,
        date=on,
        person_id=rule.person_id,
        shares=dict(rule.shares) if rule.shares else None,
        paid_by=rule.paid_by,
        recurringID=str(rule.id),
    )

def run_rule(db: Session, rule: RecurringTransaction, today: date) -> int:
    """Catch up every date since last_run. Running twice never adds a date twice."""
    if rule.paused:
        return 0
    added = 0
    rule_id = str(rule.id)
    for on in dates_between(rule, rule.last_run, today):
        exists = db.exec(select(Transaction.id).where(Transaction.recurringID == rule_id).where(Transaction.date == on)).first()
        if not exists:
            db.add(make_transaction(rule, on))
            added += 1
    rule.last_run = today
    db.add(rule)
    return added

def run_all(db: Session, today: date | None = None) -> int:
    today = today or household_today(db)
    added = 0
    for rule in db.exec(select(RecurringTransaction)).all():
        added += run_rule(db, rule, today)
    db.commit()
    if added:
        log.info("Recurring engine added %s transactions", added)
    return added

def seconds_until(hour: int, minute: int, tz) -> float:
    now = datetime.now(tz)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()

async def scheduler():
    """Just after midnight in the household's time zone: add the day's recurring transactions.
    At three: the nightly backup (when it is on)."""
    from .. import database
    from .backups import nightly_backup
    while True:
        with Session(database.engine) as db:
            tz = household_tz(db)
        wait_engine = seconds_until(0, 1, tz)
        wait_backup = seconds_until(3, 0, tz)
        await asyncio.sleep(min(wait_engine, wait_backup))
        try:
            with Session(database.engine) as db:
                if wait_engine <= wait_backup:
                    run_all(db)
                else:
                    nightly_backup(db)
        except Exception:
            log.exception("Scheduled job failed")
        await asyncio.sleep(1)
