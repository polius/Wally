from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from api.database import get_session
from api.models.categories import Category
from api.models.transactions import Transaction
from api.routers.auth import check_login
from api.routers.spending_history import get_today, router
from api.services.spending_history import shift_month


@pytest.fixture
def test_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    SQLModel.metadata.create_all(engine)

    def test_session():
        with Session(engine) as db:
            yield db

    app = FastAPI()
    app.include_router(router)

    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[check_login] = lambda: True
    app.dependency_overrides[get_today] = (
        lambda: date(2026, 9, 29)
    )

    with Session(engine) as db:
        db.add(Category(name="Food"))
        db.add(Category(name="Travel"))
        db.commit()

    def add_transaction(
        amount,
        transaction_date,
        category="Food",
        transaction_type="expense",
    ):
        with Session(engine) as db:
            db.add(Transaction(
                name="US-3 test",
                category=category,
                tags=[],
                amount=Decimal(amount),
                type=transaction_type,
                date=date.fromisoformat(transaction_date),
            ))
            db.commit()

    with TestClient(app) as client:
        yield client, add_transaction

    app.dependency_overrides.clear()
    engine.dispose()


def read_food(client):
    response = client.get(
        "/spending-history",
        params={"category": "Food", "months": 6},
    )
    assert response.status_code == 200
    return response.json()


def test_monthly_totals_and_zero_gap(test_context):
    client, add = test_context

    add("50.10", "2026-06-05")
    add("75.20", "2026-06-15")
    add("40.00", "2026-08-20")

    result = read_food(client)

    assert result["window_start"] == "2026-03-01"
    assert result["window_end_exclusive"] == "2026-09-01"

    assert [
        item["month"] for item in result["history"]
    ] == ["2026-06", "2026-07", "2026-08"]

    assert [
        Decimal(item["amount"]) for item in result["history"]
    ] == [
        Decimal("125.30"),
        Decimal("0.00"),
        Decimal("40.00"),
    ]


def test_only_selected_category_expenses(test_context):
    client, add = test_context

    add("25.00", "2026-08-10")
    add("100.00", "2026-08-10", category="Travel")
    add(
        "500.00",
        "2026-08-10",
        transaction_type="income",
    )

    result = read_food(client)

    assert len(result["history"]) == 1
    assert Decimal(
        result["history"][0]["amount"]
    ) == Decimal("25.00")


def test_window_boundaries(test_context):
    client, add = test_context

    add("99.00", "2026-02-28")
    add("10.00", "2026-03-01")
    add("20.00", "2026-08-31")
    add("99.00", "2026-09-01")

    result = read_food(client)
    history = result["history"]

    assert len(history) == 6

    total = sum(
        (Decimal(item["amount"]) for item in history),
        Decimal("0.00"),
    )

    assert total == Decimal("30.00")


def test_chronological_order(test_context):
    client, add = test_context

    add("30.00", "2026-08-10")
    add("10.00", "2026-06-10")
    add("20.00", "2026-07-10")

    result = read_food(client)

    assert [
        item["month"] for item in result["history"]
    ] == ["2026-06", "2026-07", "2026-08"]


def test_trailing_months_are_zero(test_context):
    client, add = test_context

    add("15.00", "2026-06-10")

    result = read_food(client)

    assert [
        Decimal(item["amount"]) for item in result["history"]
    ] == [
        Decimal("15.00"),
        Decimal("0.00"),
        Decimal("0.00"),
    ]


def test_no_transactions(test_context):
    client, _ = test_context
    assert read_food(client)["history"] == []


def test_only_transactions_outside_window(test_context):
    client, add = test_context

    add("50.00", "2025-01-10")
    add("50.00", "2026-09-10")

    assert read_food(client)["history"] == []


def test_unknown_category(test_context):
    client, _ = test_context

    response = client.get(
        "/spending-history",
        params={"category": "Unknown"},
    )

    assert response.status_code == 404


@pytest.mark.parametrize("months", [0, 7])
def test_invalid_month_count(test_context, months):
    client, _ = test_context

    response = client.get(
        "/spending-history",
        params={"category": "Food", "months": months},
    )

    assert response.status_code == 422


def test_year_boundary():
    assert shift_month(
        date(2026, 1, 1), -6
    ) == date(2025, 7, 1)

    assert shift_month(
        date(2026, 12, 1), 1
    ) == date(2027, 1, 1)