import unittest
from datetime import date
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from api.database import get_session
from api.models.recurring_transactions import RecurringTransaction
from api.models.subscription_alerts import SubscriptionPriceAlert
from api.models.transactions import Transaction
from api.routers.auth import check_login
from api.routers.recurring_transactions import router as recurring_router
from api.routers.subscription_alerts import router as subscription_alerts_router
from api.services.budget_alerts import SUBSCRIPTION_JOB_ID, create_scheduler
from api.services.subscription_alerts import (
    check_subscription_price_alerts,
    detect_price_increase,
    usual_price,
)

test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


def get_test_session():
    with Session(test_engine) as session:
        yield session


def skip_login():
    return True


test_app = FastAPI()
test_app.include_router(recurring_router)
test_app.include_router(subscription_alerts_router)
test_app.dependency_overrides[get_session] = get_test_session
test_app.dependency_overrides[check_login] = skip_login

client = TestClient(test_app)


def d(*values):
    return [Decimal(str(value)) for value in values]


class UsualPriceTests(unittest.TestCase):
    def test_usual_price_is_median_of_last_three_charges(self):
        self.assertEqual(usual_price(d(9.99)), Decimal("9.99"))
        self.assertEqual(usual_price(d(10, 10, 25)), Decimal("10"))
        self.assertEqual(usual_price(d(5, 5, 5, 10, 10, 10)), Decimal("10"))

    def test_no_charges_has_no_usual_price(self):
        self.assertIsNone(usual_price([]))


class DetectPriceIncreaseTests(unittest.TestCase):
    def test_increase_is_detected_with_old_and_new_price(self):
        self.assertEqual(detect_price_increase(d(9.99, 9.99, 9.99, 12.99)), (Decimal("9.99"), Decimal("12.99")))

    def test_unchanged_price_does_not_alert(self):
        self.assertIsNone(detect_price_increase(d(9.99, 9.99, 9.99, 9.99)))

    def test_decreased_price_does_not_alert(self):
        self.assertIsNone(detect_price_increase(d(12.99, 12.99, 12.99, 9.99)))

    def test_first_charge_does_not_alert(self):
        self.assertIsNone(detect_price_increase(d(12.99)))

    def test_new_price_does_not_alert_again_on_following_charges(self):
        self.assertIsNone(detect_price_increase(d(9.99, 9.99, 12.99, 12.99)))
        self.assertIsNone(detect_price_increase(d(9.99, 12.99, 12.99, 12.99)))

    def test_back_to_normal_after_one_expensive_charge_does_not_alert(self):
        self.assertIsNone(detect_price_increase(d(10, 10, 15, 10)))

    def test_second_increase_is_detected(self):
        self.assertEqual(detect_price_increase(d(10, 12, 12, 12, 15)), (Decimal("12"), Decimal("15")))


class SubscriptionAlertTestCase(unittest.TestCase):
    def setUp(self):
        SQLModel.metadata.create_all(test_engine)
        self.db = Session(test_engine)

    def tearDown(self):
        self.db.close()
        SQLModel.metadata.drop_all(test_engine)

    def add_series(self, amounts, start=date(2026, 6, 1), name="Netflix", is_subscription=True, type="expense"):
        """Store a monthly recurring transaction with one transaction per amount."""
        recurring = RecurringTransaction(
            name=name,
            category="Entertainment",
            amount=Decimal(str(amounts[-1])),
            type=type,
            startDate=start,
            endDate=start + relativedelta(months=len(amounts) - 1),
            frequency="monthly",
            isSubscription=is_subscription,
        )
        self.db.add(recurring)
        for n, amount in enumerate(amounts):
            self.db.add(Transaction(
                name=name,
                category="Entertainment",
                amount=Decimal(str(amount)),
                type=type,
                date=start + relativedelta(months=n),
                recurringID=str(recurring.id),
            ))
        self.db.commit()
        return recurring

    def alerts(self):
        return self.db.exec(select(SubscriptionPriceAlert)).all()


class CheckSubscriptionPriceAlertTests(SubscriptionAlertTestCase):
    # Charges on Jun 1, Jul 1, Aug 1 and Sep 1
    TODAY = date(2026, 9, 15)

    def test_increase_creates_alert(self):
        recurring = self.add_series([9.99, 9.99, 9.99, 12.99])
        created = check_subscription_price_alerts(self.db, self.TODAY)

        self.assertEqual(len(created), 1)
        alert = created[0]
        self.assertEqual(alert.recurring_id, str(recurring.id))
        self.assertEqual(alert.name, "Netflix")
        self.assertEqual(alert.category, "Entertainment")
        self.assertEqual(alert.frequency, "monthly")
        self.assertEqual(alert.charge_date, date(2026, 9, 1))
        self.assertEqual(alert.previous_amount, Decimal("9.99"))
        self.assertEqual(alert.new_amount, Decimal("12.99"))

    def test_unchanged_amount_creates_no_alert(self):
        self.add_series([9.99, 9.99, 9.99, 9.99])
        self.assertEqual(check_subscription_price_alerts(self.db, self.TODAY), [])
        self.assertEqual(self.alerts(), [])

    def test_decreased_amount_creates_no_alert(self):
        self.add_series([12.99, 12.99, 12.99, 9.99])
        self.assertEqual(check_subscription_price_alerts(self.db, self.TODAY), [])
        self.assertEqual(self.alerts(), [])

    def test_repeated_checks_do_not_duplicate(self):
        self.add_series([9.99, 9.99, 9.99, 12.99])
        for _ in range(5):
            check_subscription_price_alerts(self.db, self.TODAY)
        self.assertEqual(len(self.alerts()), 1)

    def test_next_charge_at_new_price_does_not_alert_again(self):
        self.add_series([9.99, 9.99, 9.99, 12.99, 12.99])
        check_subscription_price_alerts(self.db, self.TODAY)
        self.assertEqual(check_subscription_price_alerts(self.db, date(2026, 10, 15)), [])
        self.assertEqual(len(self.alerts()), 1)

    def test_future_charges_are_ignored_until_they_happen(self):
        self.add_series([9.99, 9.99, 9.99, 12.99])
        self.assertEqual(check_subscription_price_alerts(self.db, date(2026, 8, 31)), [])
        self.assertEqual(len(check_subscription_price_alerts(self.db, date(2026, 9, 1))), 1)

    def test_only_subscription_expenses_are_checked(self):
        self.add_series([500, 500, 550], name="Rent", is_subscription=False)
        self.add_series([2000, 2000, 2200], name="Salary", type="income")
        self.assertEqual(check_subscription_price_alerts(self.db, self.TODAY), [])

    def test_each_subscription_is_checked_separately(self):
        self.add_series([9.99, 9.99, 12.99], name="Netflix")
        self.add_series([5.99, 5.99, 5.99], name="Spotify")
        self.add_series([3, 3, 4], name="Cloud storage")
        created = check_subscription_price_alerts(self.db, self.TODAY)
        self.assertEqual(sorted(alert.name for alert in created), ["Cloud storage", "Netflix"])


class SubscriptionAlertAPITests(SubscriptionAlertTestCase):
    def create_subscription(self, amount="9.99"):
        today = date.today()
        response = client.post("/recurring", json={
            "name": "Netflix",
            "category": "Entertainment",
            "amount": amount,
            "type": "expense",
            "startDate": (today - relativedelta(months=3)).isoformat(),
            "endDate": (today + relativedelta(months=6)).isoformat(),
            "frequency": "monthly",
            "isSubscription": True,
        })
        self.assertEqual(response.status_code, 200)
        return response.json()["id"]

    def test_price_change_from_settings_alerts_on_next_charge(self):
        # The user raises the price for future charges, like they would in Settings.
        recurring_id = self.create_subscription()
        client.put(f"/recurring/{recurring_id}", json={"amount": "12.99", "applyTo": "future"})

        # Nothing has been charged at the new price yet.
        self.assertEqual(client.post("/subscription-alerts/check").json(), [])

        next_charge = self.db.exec(
            select(Transaction.date)
            .where(Transaction.recurringID == recurring_id, Transaction.date > date.today())
            .order_by(Transaction.date)
        ).first()
        created = check_subscription_price_alerts(self.db, next_charge)

        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].previous_amount, Decimal("9.99"))
        self.assertEqual(created[0].new_amount, Decimal("12.99"))

    def test_list_and_dismiss(self):
        self.add_series([9.99, 9.99, 12.99], start=date.today() - relativedelta(months=2))
        self.assertEqual(len(client.post("/subscription-alerts/check").json()), 1)

        alerts = client.get("/subscription-alerts").json()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["name"], "Netflix")
        self.assertEqual(alerts[0]["previous_amount"], "9.99")
        self.assertEqual(alerts[0]["new_amount"], "12.99")

        response = client.post(f"/subscription-alerts/{alerts[0]['id']}/dismiss")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["dismissed"])

        self.assertEqual(client.get("/subscription-alerts").json(), [])
        self.assertEqual(len(client.get("/subscription-alerts?include_dismissed=true").json()), 1)
        # A dismissed alert does not come back
        self.assertEqual(client.post("/subscription-alerts/check").json(), [])

    def test_dismiss_unknown_alert_returns_404(self):
        self.assertEqual(client.post("/subscription-alerts/999/dismiss").status_code, 404)

    def test_deleting_subscription_removes_its_alerts(self):
        recurring = self.add_series([9.99, 9.99, 12.99], start=date.today() - relativedelta(months=2))
        client.post("/subscription-alerts/check")

        response = client.request("DELETE", f"/recurring/{recurring.id}", json={"applyTo": "all"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/subscription-alerts?include_dismissed=true").json(), [])


class SubscriptionAlertSchedulerTests(unittest.TestCase):
    def test_scheduler_runs_price_check_in_background(self):
        scheduler = create_scheduler(interval_minutes=5)
        job = scheduler.get_job(SUBSCRIPTION_JOB_ID)

        self.assertIsNotNone(job)
        self.assertEqual(job.trigger.interval.total_seconds(), 300)
        self.assertEqual(job.max_instances, 1)


if __name__ == "__main__":
    unittest.main()
