import os
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

def household_tz(db=None) -> ZoneInfo:
    """The household's time zone: Settings first, then the TZ variable, then UTC."""
    name = None
    if db is not None:
        from .models.app import AppConfig
        row = db.get(AppConfig, "TIMEZONE")
        name = row.value if row and row.value else None
    for candidate in (name, os.getenv("TZ"), "UTC"):
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return ZoneInfo("UTC")

def today(db=None) -> date:
    """Today in the household's time zone, which is what 'today' means to the people using Wally.
    WALLY_TODAY fixes the date, for tests."""
    fixed = os.getenv("WALLY_TODAY")
    if fixed:
        return date.fromisoformat(fixed)
    return datetime.now(household_tz(db)).date()

def to_cents(amount) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def from_cents(cents: int) -> Decimal:
    return (Decimal(cents) / 100).quantize(Decimal("0.01"))

def even_shares(total_cents: int, people: list[int], payer: int | None) -> dict[str, int]:
    """Split an amount evenly in cents. The spare cents go to whoever paid, so shares always add up."""
    if not people:
        return {}
    base, spare = divmod(total_cents, len(people))
    shares = {str(p): base for p in people}
    order = sorted(people, key=lambda p: (p != payer, people.index(p)))
    for p in order[:spare]:
        shares[str(p)] += 1
    return shares
