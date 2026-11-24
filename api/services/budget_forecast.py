from datetime import date
from decimal import Decimal, ROUND_HALF_UP

MIN_DAYS_OF_DATA = 2  # serve almeno 1 giorno pieno di spesa per proiettare

def forecast_month_end(
    spent: Decimal,
    window_start: date,
    window_end: date,
    today: date,
) -> Decimal | None:
    if spent <= 0:
        return None  # "not enough data": nessuna spesa nel periodo

    total_days = (window_end - window_start).days + 1
    elapsed_days = (today - window_start).days + 1  # il giorno corrente conta

    if elapsed_days <= 0:
        return None  # il periodo non è ancora iniziato
    if today >= window_end or elapsed_days >= total_days:
        return spent  # periodo finito: la spesa attuale È quella finale
    if elapsed_days < MIN_DAYS_OF_DATA:
        return None  # troppo presto per estrapolare senza ingrandire il rumore

    projected = (spent / elapsed_days) * total_days
    return projected.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)