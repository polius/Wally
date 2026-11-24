from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from api.database import get_session
from api.models.recurring_transactions import RecurringTransaction
from api.routers.auth import check_login
from api.routers.subscriptions import router as subscriptions_router
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from api.services.subscriptions import (
    monthly_equivalent,
    next_charge,
    subscription_summary,
)


class SubscriptionTests(unittest.TestCase):

    def test_monthly_conversions(self):
        self.assertEqual(
            monthly_equivalent(Decimal("12"), "monthly"),
            Decimal("12"),
        )
        self.assertEqual(
            monthly_equivalent(Decimal("12"), "weekly"),
            Decimal("52"),
        )
        self.assertEqual(
            monthly_equivalent(Decimal("90"), "quarterly"),
            Decimal("30"),
        )
        self.assertEqual(
            monthly_equivalent(Decimal("120"), "yearly"),
            Decimal("10"),
        )

    def test_next_charge(self):
        result = next_charge(
            date(2026, 1, 15),
            date(2027, 12, 31),
            "quarterly",
            today=date(2026, 10, 23),
        )
        self.assertEqual(result, date(2027, 1, 15))

    def test_empty_summary(self):
        result = subscription_summary([])

        self.assertEqual(result["subscriptions"], [])
        self.assertEqual(result["monthlyTotal"], 0.0)

    def test_mixed_subscriptions(self):
        subscriptions = [
            SimpleNamespace(
                name="Netflix",
                amount=Decimal("15"),
                frequency="monthly",
                startDate=date(2026, 1, 1),
                endDate=date(2027, 12, 31),
                isSubscription=True,
                type="expense",
            ),
            SimpleNamespace(
                name="Spotify",
                amount=Decimal("120"),
                frequency="yearly",
                startDate=date(2026, 1, 1),
                endDate=date(2027, 12, 31),
                isSubscription=True,
                type="expense",
            ),
            SimpleNamespace(
                name="Rent",
                amount=Decimal("650"),
                frequency="monthly",
                startDate=date(2026, 1, 1),
                endDate=date(2027, 12, 31),
                isSubscription=False,
                type="expense",
            ),
        ]

        result = subscription_summary(
            subscriptions,
            today=date(2026, 10, 23),
        )

        self.assertEqual(len(result["subscriptions"]), 2)
        self.assertEqual(result["monthlyTotal"], 25.0)

    def test_expired_subscription(self):
        subscription = SimpleNamespace(
            name="Old Subscription",
            amount=Decimal("10"),
            frequency="monthly",
            startDate=date(2025, 1, 1),
            endDate=date(2025, 12, 31),
            isSubscription=True,
            type="expense",
        )

        result = subscription_summary(
            [subscription],
            today=date(2026, 10, 23),
        )

        self.assertEqual(result["subscriptions"], [])
        self.assertEqual(result["monthlyTotal"], 0.0)


    def test_next_charge_month_end_without_end_date(self):
        result = next_charge(
            date(2026, 1, 31),
            None,
            "monthly",
            date(2026, 3, 1),
        )
        self.assertEqual(result, date(2026, 3, 31))


class SubscriptionAPITests(unittest.TestCase):

    def test_subscription_summary_endpoint(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)

        def get_test_session():
            with Session(engine) as session:
                yield session

        app = FastAPI()
        app.include_router(subscriptions_router)
        app.dependency_overrides[get_session] = get_test_session
        app.dependency_overrides[check_login] = lambda: True

        with Session(engine) as session:
            session.add(
                RecurringTransaction(
                    name="Test Subscription",
                    category="Entertainment",
                    amount=Decimal("24"),
                    type="expense",
                    frequency="monthly",
                    startDate=date(2026, 1, 1),
                    endDate=date(2028, 12, 31),
                    isSubscription=True,
                )
            )
            session.commit()

        with TestClient(app) as client:
            response = client.get("/subscriptions/summary")

        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["monthlyTotal"], 24.0)
        self.assertEqual(len(data["subscriptions"]), 1)
        self.assertEqual(
            data["subscriptions"][0]["name"],
            "Test Subscription",
        )

        SQLModel.metadata.drop_all(engine)
        engine.dispose()
if __name__ == "__main__":
    unittest.main()
