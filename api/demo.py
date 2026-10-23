from pathlib import Path
from sqlmodel import SQLModel, Session, create_engine
from datetime import date
from dateutil.relativedelta import relativedelta
from decimal import Decimal
import random
import calendar
import secrets

from .models.transactions import Transaction
from .models.categories import Category
from .models.tags import Tag
from .models.currency import Currency
from .models.app import AppConfig
from .models.people import Person
from .models.recurring_transactions import RecurringTransaction

# ------------------------
# Defaults
# ------------------------
DEFAULT_CATEGORIES = [
    "Entertainment", "Food", "Groceries", "Healthcare", "Income",
    "Miscellaneous", "Rent", "Shopping", "Travel", "Utilities"
]

DEFAULT_TAGS = [
    "urgent", "monthly", "recurring", "gift", "bonus", "vacation", "subscription"
]

DEFAULT_CURRENCIES = [
    {"name": "AED", "symbol": "AED", "position": "left", "selected": False},
    {"name": "AUD", "symbol": "A$", "position": "left", "selected": False},
    {"name": "BDT", "symbol": "৳", "position": "left", "selected": False},
    {"name": "BRL", "symbol": "R$", "position": "left", "selected": False},
    {"name": "CAD", "symbol": "C$", "position": "left", "selected": False},
    {"name": "CHF", "symbol": "Fr", "position": "left", "selected": False},
    {"name": "CNY", "symbol": "¥", "position": "left", "selected": False},
    {"name": "DKK", "symbol": "kr.", "position": "right", "selected": False},
    {"name": "EUR", "symbol": "€", "position": "left", "selected": True},
    {"name": "GBP", "symbol": "£", "position": "left", "selected": False},
    {"name": "HKD", "symbol": "HK$", "position": "left", "selected": False},
    {"name": "IDR", "symbol": "Rp", "position": "left", "selected": False},
    {"name": "ILS", "symbol": "₪", "position": "left", "selected": False},
    {"name": "INR", "symbol": "₹", "position": "left", "selected": False},
    {"name": "JPY", "symbol": "¥", "position": "left", "selected": False},
    {"name": "KRW", "symbol": "₩", "position": "left", "selected": False},
    {"name": "MXN", "symbol": "Mex$", "position": "left", "selected": False},
    {"name": "MYR", "symbol": "RM", "position": "left", "selected": False},
    {"name": "NZD", "symbol": "NZ$", "position": "left", "selected": False},
    {"name": "PHP", "symbol": "₱", "position": "left", "selected": False},
    {"name": "PLN", "symbol": "zł", "position": "right", "selected": False},
    {"name": "RUB", "symbol": "₽", "position": "left", "selected": False},
    {"name": "SEK", "symbol": "kr", "position": "right", "selected": False},
    {"name": "SGD", "symbol": "S$", "position": "left", "selected": False},
    {"name": "THB", "symbol": "฿", "position": "left", "selected": False},
    {"name": "TRY", "symbol": "₺", "position": "left", "selected": False},
    {"name": "USD", "symbol": "$", "position": "left", "selected": False},
    {"name": "VND", "symbol": "₫", "position": "right", "selected": False},
    {"name": "ZAR", "symbol": "R", "position": "left", "selected": False},
]

DEFAULT_CONFIG = [
    {"key": 'SECRET_KEY', "value": secrets.token_hex(32)},
    {"key": 'LOGIN_PAGE', "value": False},
    {"key": 'LOGIN_PASSWORD', "value": ''},
    {"key": 'LOGIN_TOKEN', "value": ''},
    {"key": 'SELECTED_CURRENCY', "value": 'EUR'},
    {"key": 'CURRENCY_POSITION', "value": 'left'},
    {"key": 'LANGUAGE', "value": 'en'},
]

CATEGORY_TAGS = {
    "Rent": ["monthly", "recurring"],
    "Groceries": ["monthly", "recurring"],
    "Food": ["daily", "urgent"],
    "Utilities": ["monthly", "recurring"],
    "Entertainment": ["fun", "special"],
    "Healthcare": ["urgent"],
    "Shopping": ["special"],
    "Travel": ["vacation"],
    "Miscellaneous": [],
    "Income": ["salary", "bonus"]
}

# ------------------------
# Utils
# ------------------------
def random_date_for_month(year: int, month: int):
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, random.randint(1, last_day))

def generate_month_transactions(year: int, month: int, n: int):
    """Generate ~n transactions with realistic amounts and mostly positive balances."""

    txs = []
    for _ in range(n):
        category = random.choices(
            DEFAULT_CATEGORIES,
            weights=[0.08, 0.2, 0.25, 0.05, 0.08, 0.04, 0.1, 0.1, 0.05, 0.05]
        )[0]
        t_type = "income" if category == "Income" else "expense"
        # smaller amounts for more realistic transactions
        amount = random.uniform(5, 100) if t_type == "expense" else random.uniform(500, 1500)
        possible_tags = CATEGORY_TAGS.get(category, []) + ["online", "special", "urgent"]
        tags = random.sample(possible_tags, k=random.randint(0, min(2, len(possible_tags))))
        tx_date = random_date_for_month(year, month)

        txs.append(Transaction(
            name=f"{category} {random.randint(1, 500)}",
            category=category,
            type=t_type,
            amount=Decimal(str(round(amount, 2))),
            tags=tags,
            date=tx_date
        ))

    # Normalize totals
    expenses = [t for t in txs if t.type == "expense"]
    incomes = [t for t in txs if t.type == "income"]

    # Set monthly targets so income is usually >= expenses
    expense_target = random.uniform(2000, 4000)
    income_target = expense_target * random.uniform(1.0, 1.5)  # income ≥ expenses most months

    def normalize(group, target_sum):
        if not group: 
            return
        current_sum = sum(float(t.amount) for t in group)
        scale = target_sum / current_sum if current_sum > 0 else 1
        for t in group:
            t.amount = Decimal(str(round(float(t.amount) * scale, 2)))

    normalize(expenses, expense_target)
    normalize(incomes, income_target)

    return txs

# ------------------------
# Main
# ------------------------
def generate_demo():
    db_path = Path("data/wally.db")

    # Safety check: refuse to run demo mode if a real database already exists
    if db_path.exists():
        print("\n" + "=" * 60)
        print("ERROR: Cannot start in DEMO mode.")
        print(f"An existing database was found at: {db_path.resolve()}")
        print("This may contain real data that would be permanently lost.")
        print("Remove the database file manually or unset DEMO=true.")
        print("=" * 60 + "\n")
        raise SystemExit(1)

    db_path.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{db_path}")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all([Category(name=c) for c in DEFAULT_CATEGORIES])
        session.add_all([Tag(name=t) for t in DEFAULT_TAGS])
        session.add_all([Currency(**c) for c in DEFAULT_CURRENCIES])
        session.add_all([AppConfig(**c) for c in DEFAULT_CONFIG])
        session.add(Person(id="alex", name="Alex", is_self=True))
        session.add(Person(id="ana", name="Ana"))
        session.commit()

        owner_ids = ["alex", "ana"]
        current_year = date.today().year
        current_month = date.today().month
        years = [current_year - 2, current_year - 1, current_year, current_year + 1, current_year + 2]

        for year in years:
            for month in range(1, 12 + 1):
                txs = generate_month_transactions(year, month, n=random.randint(50, 100))
                for tx in txs:
                    tx.person_id = random.choice(owner_ids)
                    tx.shares = []
                # One shared cost in the current month, split 50/50.
                if year == current_year and month == current_month:
                    candidates = [t for t in txs if t.type == "expense"]
                    if candidates:
                        shared = random.choice(candidates)
                        shared.name = "Groceries shared"
                        shared.category = "Groceries"
                        shared.amount = Decimal("37.34")
                        shared.person_id = None
                        shared.shares = [
                            {"person_id": "alex", "amount": "18.67"},
                            {"person_id": "ana", "amount": "18.67"},
                        ]
                session.add_all(txs)
                session.commit()

        # Three rules, already carrying an owner, that fire from next month on.
        next_month = (date.today().replace(day=1) + relativedelta(months=1))
        end = next_month + relativedelta(years=2)
        session.add_all([
            RecurringTransaction(
                name="Rent share", category="Rent", tags=["monthly", "recurring"],
                amount=Decimal("236.08"), type="expense", startDate=next_month,
                endDate=end, frequency="monthly", person_id="alex",
            ),
            RecurringTransaction(
                name="Netflix", category="Entertainment", tags=["subscription"],
                amount=Decimal("15.99"), type="expense", startDate=next_month,
                endDate=end, frequency="monthly", person_id="ana",
            ),
            RecurringTransaction(
                name="Salary", category="Income", tags=["monthly", "bonus"],
                amount=Decimal("2418.44"), type="income", startDate=next_month,
                endDate=end, frequency="monthly", person_id="ana",
            ),
        ])
        session.commit()

    print(f"✅ Database 'wally.db' created in {db_path.resolve()}.")

if __name__ == "__main__":
    generate_demo()
