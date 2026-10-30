"""Demo mode (DEMO=true): a household of two with about two years of believable spending.

Recurring bills and salaries are real rules, turned into transactions by the same engine
that runs in production. Nothing is kept: the database is made fresh on every start.
"""
import random
import calendar
from datetime import date, timedelta
from decimal import Decimal
from dateutil.relativedelta import relativedelta
from sqlmodel import Session

from . import database
from .models.app import AppConfig
from .models.people import Person
from .models.transactions import Transaction
from .models.recurring_transactions import RecurringTransaction
from .models.money import ImportRule
from .models.tags import Tag
from .services.engine import run_all
from .services.ledger import resolve_owner
from .util import today as household_today

def _money(value: float) -> Decimal:
    return Decimal(str(round(value, 2)))

def generate_demo():
    db_path = database.DB_PATH

    # Safety check: refuse to run demo mode if a real database already exists
    if db_path.exists():
        print("\n" + "=" * 60)
        print("ERROR: Cannot start in DEMO mode.")
        print(f"An existing database was found at: {db_path.resolve()}")
        print("This may contain real data that would be permanently lost.")
        print("Remove the database file manually or unset DEMO=true.")
        print("=" * 60 + "\n")
        raise SystemExit(1)

    database.create_db_and_tables()
    rng = random.Random(20261024)
    today = household_today()
    start = (today.replace(day=1) - relativedelta(months=21))

    with Session(database.engine) as db:
        alex, ana = Person(name="Alex", position=0), Person(name="Ana", position=1)
        db.add_all([alex, ana])
        db.add(AppConfig(key="ONBOARDED", value="1"))
        db.commit()
        db.refresh(alex)
        db.refresh(ana)
        A, N = alex.id, ana.id
        ids = [A, N]

        def owner(person, payer=None):
            return {"person_id": person, "paid_by": payer}

        def add(on: date, name: str, category: str, amount: float, person=None, payer=None, tags=None, type="expense"):
            data = {"name": name, "category": category, "amount": _money(amount), "type": type, "tags": tags or [], "date": on, **owner(person, payer)}
            if person is None and type == "expense" and payer is None:
                data["paid_by"] = rng.choice(ids)
            data = resolve_owner(db, data, None, ids)
            db.add(Transaction(**data, created_by=person if person is not None else data.get("paid_by")))

        def rule(name, category, amount, person, day_start, frequency="monthly", interval=1, end=None, type="expense", payer=None, about=False):
            data = {"name": name, "category": category, "amount": _money(amount), "type": type, "startDate": day_start,
                    "endDate": end, "frequency": frequency, "interval": interval, "about": about, "tags": [], **owner(person, payer)}
            data = resolve_owner(db, data, None, ids)
            db.add(RecurringTransaction(**data))

        def on_day(year, month, day):
            return date(year, month, min(day, calendar.monthrange(year, month)[1]))

        s = start
        price_change = (today.replace(day=1) - relativedelta(months=7))
        spotify_change = (today.replace(day=1) - relativedelta(months=14))
        rule("Alex salary", "Income", 2450, A, on_day(s.year, s.month, 1), type="income")
        rule("Ana salary", "Income", 2780, N, on_day(s.year, s.month, 2), type="income")
        rule("Rent", "Rent", 1250, None, on_day(s.year, s.month, 1), payer=A)
        rule("Digi Fibra", "Utilities", 45, None, on_day(s.year, s.month, 5), payer=A)
        rule("Spotify", "Entertainment", 9.99, A, on_day(s.year, s.month, 9), end=on_day(spotify_change.year, spotify_change.month, 8))
        rule("Spotify", "Entertainment", 10.99, A, on_day(spotify_change.year, spotify_change.month, 9))
        rule("Simyo", "Utilities", 20, A, on_day(s.year, s.month, 12))
        rule("Netflix", "Entertainment", 11.99, None, on_day(s.year, s.month, 27), payer=N, end=on_day(price_change.year, price_change.month, 26))
        rule("Netflix", "Entertainment", 13.99, None, on_day(price_change.year, price_change.month, 27), payer=N)
        rule("DiR Gym", "Healthcare", 39, A, on_day(s.year, s.month, 28))
        rule("Pepephone", "Utilities", 24, N, on_day(s.year, s.month, 30))
        swim = today - timedelta(days=50)
        rule("Swimming lessons", "Healthcare", 32, N, swim, frequency="weekly", interval=2, end=swim + timedelta(weeks=30))
        insurance = today.replace(day=14) - relativedelta(months=11)
        rule("Car insurance", "Utilities", 384, None, insurance, frequency="yearly", payer=A)
        db.commit()

        cursor = start
        while cursor <= today:
            y, m = cursor.year, cursor.month
            last = min(calendar.monthrange(y, m)[1], today.day if (y, m) == (today.year, today.month) else 31)
            def day(d):
                return date(y, m, d)
            if rng.random() < .45 and 15 <= last:
                add(day(15), "Ana freelance", "Income", round(rng.uniform(250, 700) / 10) * 10, N, type="income")
            if m == 12 and 19 <= last:
                add(day(19), "Alex bonus", "Income", 1100, A, type="income")
            if 13 <= last:
                add(day(13), "Holaluz", "Utilities", rng.uniform(88, 128) if (m <= 3 or m >= 11) else rng.uniform(46, 78), A)
            if m % 2 == 0 and 18 <= last:
                add(day(18), "Aigües de Barcelona", "Utilities", rng.uniform(28, 42), N)
            if m in (3, 9) and 11 <= last:
                add(day(11), "Clínica Dental Sants", "Healthcare", 75, N)
            for d in range(1, last + 1):
                current = day(d)
                weekend = current.weekday() >= 5
                if rng.random() < (.55 if weekend else .27):
                    name = rng.choice(["Mercadona", "Mercadona", "Mercadona", "Lidl", "Lidl", "Bon Preu", "Bon Preu", "Carrefour", "Fruiteria Rosa"])
                    add(current, name, "Groceries", rng.uniform(42, 118) if weekend else rng.uniform(11, 52), rng.choice(ids))
                if rng.random() < .33:
                    if current.weekday() in (4, 5) and rng.random() < .55:
                        add(current, rng.choice(["Bar Pinotxo", "Honest Greens", "La Pubilla", "Glovo"]), "Food", rng.uniform(26, 68), None if rng.random() < .35 else rng.choice(ids))
                    else:
                        add(current, rng.choice(["Café Nómada", "Forn Sant Jordi", "Satan's Coffee"]), "Food", rng.uniform(3.2, 11.5), rng.choice(ids), tags=["coffee"])
                if rng.random() < .075:
                    name = rng.choice(["Decathlon", "Zara", "Amazon", "IKEA", "FNAC"])
                    add(current, name, "Shopping", rng.uniform(14, 118), rng.choice(ids), tags=["sport"] if name == "Decathlon" else [])
                if rng.random() < .035:
                    add(current, "Cinesa" if rng.random() < .6 else "Razzmatazz", "Entertainment", rng.uniform(16, 48), None if rng.random() < .6 else A)
                if rng.random() < .045:
                    add(current, "Farmacia Central", "Healthcare", rng.uniform(6, 28), rng.choice(ids))
                if rng.random() < .05:
                    name = rng.choice(["Correos", "Barbería Gràcia", "Gift"])
                    add(current, name, "Miscellaneous", rng.uniform(5, 40), rng.choice(ids), tags=["gift"] if name == "Gift" else [])
            if m == 12:
                for d in (5, 8, 11, 14, 17, 21):
                    if d <= last:
                        add(day(d), rng.choice(["Amazon", "FNAC", "El Corte Inglés"]), "Shopping", rng.uniform(35, 160), rng.choice(ids), tags=["gift"])
                if 23 <= last:
                    add(day(23), "Renfe", "Travel", 186, None, tags=["holiday"])
            if m == 8 and 9 <= last:
                add(day(8), "Vueling", "Travel", 420, None, tags=["holiday"])
                add(day(9), "Airbnb Menorca", "Travel", 690, None, tags=["holiday"])
            if m == 4 and 18 <= last:
                add(day(17), "Renfe", "Travel", 128, None, tags=["holiday"])
                add(day(18), "Hotel Girona", "Travel", 240, None, tags=["holiday"])
            cursor = (cursor + relativedelta(months=1)).replace(day=1)
        db.commit()

        # The engine makes every rule's transactions up to today, as it does every night
        run_all(db, today)

        for name in ("coffee", "sport", "gift", "holiday"):
            if not db.get(Tag, name):
                db.add(Tag(name=name))

        # Import rules to look at
        for position, (match, category, person, learned) in enumerate([("MERCADONA", "Groceries", N, True), ("NETFLIX", "Entertainment", None, False),
                                                                        ("HOLALUZ", "Utilities", A, True), ("DECATHLON", "Shopping", A, False), ("GLOVO", "Food", None, True)]):
            db.add(ImportRule(match=match, category=category, person_id=person, learned=learned, position=position, uses=rng.randint(8, 80)))
        db.commit()

    print(f"✅ Demo database created in {db_path.resolve()}.")
