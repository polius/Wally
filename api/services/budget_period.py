import calendar
from datetime import date, timedelta


def current_window(period: str, start_date: date, today: date) -> tuple[date, date]:
    if period == "monthly":
        last_day = calendar.monthrange(today.year, today.month)[1]
        return date(today.year, today.month, 1), date(today.year, today.month, last_day)

    if period != "weekly":
        raise ValueError("period must be 'weekly' or 'monthly'")

    elapsed = (today - start_date).days
    if elapsed < 0:
        return start_date, start_date + timedelta(days=6)

    window_start = start_date + timedelta(days=(elapsed // 7) * 7)
    return window_start, window_start + timedelta(days=6)


def in_window(value: date, start: date, end: date) -> bool:
    return start <= value <= end