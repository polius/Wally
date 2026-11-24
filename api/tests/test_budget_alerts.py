import unittest
from datetime import date
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from api.database import get_session
from api.models.app import AppConfig
from api.models.budget_alerts import BudgetAlert, OVER_BUDGET, WARNING
from api.models.budgets import Budget
from api.models.categories import Category
from api.models.transactions import Transaction
from api.routers.auth import check_login
from api.routers.budget_alerts import router as budget_alerts_router
from api.routers.budgets import router as budgets_router
from api.services.budget_alerts import (
    JOB_ID,
    check_budget_alerts,
    create_scheduler,
    get_warning_threshold,
    set_warning_threshold,
)

test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TODAY = date(2026, 10, 20)


def get_test_session():
    with Session(test_engine) as session:
        yield session


def skip_login():
    return True


test_app = FastAPI()
test_app.include_router(budgets_router)
test_app.include_router(budget_alerts_router)
test_app.dependency_overrides[get_session] = get_test_session
test_app.dependency_overrides[check_login] = skip_login

client = TestClient(test_app)


class BudgetAlertTestCase(unittest.TestCase):
    def setUp(self):
        SQLModel.metadata.create_all(test_engine)
        self.db = Session(test_engine)
        self.db.add(Category(name="Food"))
        self.db.add(Budget(category="Food", limit=Decimal("100.00"), period="monthly", start_date=date(2026, 10, 1)))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        SQLModel.metadata.drop_all(test_engine)

    def spend(self, amount, on=TODAY, category="Food", type="expense"):
        self.db.add(Transaction(category=category, amount=Decimal(str(amount)), type=type, date=on))
        self.db.commit()

    def alerts(self, level=None):
        query = select(BudgetAlert)
        if level:
            query = query.where(BudgetAlert.level == level)
        return self.db.exec(query).all()


class BudgetAlertThresholdTests(BudgetAlertTestCase):
    def test_no_alert_below_warning_threshold(self):
        self.spend("79.99")
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])
        self.assertEqual(self.alerts(), [])

    def test_warning_fires_at_80_percent(self):
        self.spend("80.00")
        created = check_budget_alerts(self.db, TODAY)

        self.assertEqual([alert.level for alert in created], [WARNING])
        alert = created[0]
        self.assertEqual(alert.category, "Food")
        self.assertEqual(alert.spent, Decimal("80.00"))
        self.assertEqual(alert.limit, Decimal("100.00"))
        self.assertEqual(alert.threshold, 80)
        self.assertEqual((alert.window_start, alert.window_end), (date(2026, 10, 1), date(2026, 10, 31)))

    def test_over_budget_fires_at_100_percent(self):
        self.spend("80.00")
        check_budget_alerts(self.db, TODAY)
        self.spend("20.00")
        created = check_budget_alerts(self.db, TODAY)

        self.assertEqual([alert.level for alert in created], [OVER_BUDGET])
        self.assertEqual(created[0].spent, Decimal("100.00"))
        self.assertEqual(created[0].threshold, 100)

    def test_jumping_past_100_fires_both_thresholds_once(self):
        self.spend("150.00")
        created = check_budget_alerts(self.db, TODAY)
        self.assertEqual(sorted(alert.level for alert in created), [OVER_BUDGET, WARNING])

    def test_income_and_other_categories_are_ignored(self):
        self.db.add(Category(name="Rent"))
        self.spend("500.00", type="income")
        self.spend("500.00", category="Rent")
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])

    def test_spending_outside_the_window_is_ignored(self):
        self.spend("90.00", on=date(2026, 9, 30))
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])


class BudgetAlertDuplicateTests(BudgetAlertTestCase):
    def test_repeated_checks_do_not_duplicate_warning(self):
        self.spend("85.00")
        for _ in range(5):
            check_budget_alerts(self.db, TODAY)
        self.assertEqual(len(self.alerts(WARNING)), 1)

    def test_repeated_checks_do_not_duplicate_over_budget(self):
        self.spend("120.00")
        check_budget_alerts(self.db, TODAY)
        self.spend("30.00")
        for _ in range(5):
            self.assertEqual(check_budget_alerts(self.db, TODAY), [])
        self.assertEqual(len(self.alerts(WARNING)), 1)
        self.assertEqual(len(self.alerts(OVER_BUDGET)), 1)

    def test_dismissed_alert_does_not_fire_again(self):
        self.spend("85.00")
        alert = check_budget_alerts(self.db, TODAY)[0]
        alert.dismissed = True
        self.db.add(alert)
        self.db.commit()

        self.assertEqual(check_budget_alerts(self.db, TODAY), [])
        self.assertEqual(len(self.alerts(WARNING)), 1)

    def test_database_rejects_duplicate_alerts(self):
        self.spend("85.00")
        alert = check_budget_alerts(self.db, TODAY)[0]
        self.db.add(BudgetAlert(**alert.model_dump(exclude={"id"})))
        with self.assertRaises(Exception):
            self.db.commit()
        self.db.rollback()

    def test_new_monthly_period_fires_again(self):
        self.spend("85.00")
        check_budget_alerts(self.db, TODAY)

        self.spend("85.00", on=date(2026, 11, 3))
        created = check_budget_alerts(self.db, date(2026, 11, 3))

        self.assertEqual([alert.level for alert in created], [WARNING])
        self.assertEqual(created[0].window_start, date(2026, 11, 1))
        self.assertEqual(len(self.alerts(WARNING)), 2)


class WeeklyBudgetAlertTests(BudgetAlertTestCase):
    def setUp(self):
        super().setUp()
        budget = self.db.get(Budget, "Food")
        budget.period = "weekly"
        budget.limit = Decimal("50.00")
        budget.start_date = date(2026, 10, 15)  # windows: 15-21, 22-28, ...
        self.db.add(budget)
        self.db.commit()

    def test_weekly_thresholds_fire_once_per_week(self):
        self.spend("40.00", on=date(2026, 10, 16))
        self.assertEqual([a.level for a in check_budget_alerts(self.db, TODAY)], [WARNING])
        self.spend("10.00", on=date(2026, 10, 17))
        self.assertEqual([a.level for a in check_budget_alerts(self.db, TODAY)], [OVER_BUDGET])
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])

        next_week = date(2026, 10, 23)
        self.spend("60.00", on=next_week)
        created = check_budget_alerts(self.db, next_week)

        self.assertEqual(sorted(a.level for a in created), [OVER_BUDGET, WARNING])
        self.assertTrue(all(a.window_start == date(2026, 10, 22) for a in created))
        self.assertTrue(all(a.period == "weekly" for a in created))
        self.assertEqual(len(self.alerts()), 4)

    def test_previous_week_spending_does_not_count(self):
        self.spend("45.00", on=date(2026, 10, 21))
        self.assertEqual(check_budget_alerts(self.db, date(2026, 10, 22)), [])


class WarningThresholdSettingTests(BudgetAlertTestCase):
    def test_default_threshold_is_80(self):
        self.assertEqual(get_warning_threshold(self.db), 80)

    def test_invalid_stored_value_falls_back_to_default(self):
        self.db.add(AppConfig(key="BUDGET_WARNING_THRESHOLD", value="abc"))
        self.db.commit()
        self.assertEqual(get_warning_threshold(self.db), 80)

    def test_custom_threshold_is_used(self):
        set_warning_threshold(self.db, 50)
        self.spend("49.99")
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])

        self.spend("0.01")
        created = check_budget_alerts(self.db, TODAY)
        self.assertEqual([alert.level for alert in created], [WARNING])
        self.assertEqual(created[0].threshold, 50)

    def test_raising_threshold_suppresses_early_warning(self):
        set_warning_threshold(self.db, 95)
        self.spend("90.00")
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])

    def test_changing_threshold_after_warning_does_not_fire_again(self):
        self.spend("85.00")
        check_budget_alerts(self.db, TODAY)
        set_warning_threshold(self.db, 60)
        self.assertEqual(check_budget_alerts(self.db, TODAY), [])
        self.assertEqual(len(self.alerts(WARNING)), 1)


class BudgetAlertAPITests(BudgetAlertTestCase):
    def test_settings_roundtrip(self):
        self.assertEqual(client.get("/budget-alerts/settings").json(), {"warning_threshold": 80})

        response = client.put("/budget-alerts/settings", json={"warning_threshold": 70})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/budget-alerts/settings").json(), {"warning_threshold": 70})

    def test_settings_reject_out_of_range_values(self):
        for value in (0, 100, 150, -5):
            response = client.put("/budget-alerts/settings", json={"warning_threshold": value})
            self.assertEqual(response.status_code, 422, value)

    def test_lowering_threshold_creates_alert_immediately(self):
        self.spend("60.00", on=date.today())
        client.put("/budget-alerts/settings", json={"warning_threshold": 50})

        alerts = client.get("/budget-alerts").json()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["level"], WARNING)
        self.assertEqual(alerts[0]["threshold"], 50)

    def test_check_list_and_dismiss(self):
        self.spend("100.00", on=date.today())

        created = client.post("/budget-alerts/check").json()
        self.assertEqual(len(created), 2)
        self.assertEqual(client.post("/budget-alerts/check").json(), [])

        alerts = client.get("/budget-alerts").json()
        self.assertEqual(len(alerts), 2)
        self.assertEqual(alerts[0]["category"], "Food")
        self.assertEqual(alerts[0]["spent"], "100.00")
        self.assertEqual(alerts[0]["limit"], "100.00")

        response = client.post(f"/budget-alerts/{alerts[0]['id']}/dismiss")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["dismissed"])

        self.assertEqual(len(client.get("/budget-alerts").json()), 1)
        self.assertEqual(len(client.get("/budget-alerts?include_dismissed=true").json()), 2)

    def test_dismiss_unknown_alert_returns_404(self):
        self.assertEqual(client.post("/budget-alerts/999/dismiss").status_code, 404)

    def test_deleting_budget_removes_its_alerts(self):
        self.spend("100.00", on=date.today())
        client.post("/budget-alerts/check")

        client.delete("/budgets/Food")
        self.assertEqual(client.get("/budget-alerts?include_dismissed=true").json(), [])


class BudgetAlertSchedulerTests(unittest.TestCase):
    def test_scheduler_registers_interval_job(self):
        scheduler = create_scheduler(interval_minutes=5)
        job = scheduler.get_job(JOB_ID)

        self.assertIsNotNone(job)
        self.assertEqual(job.trigger.interval.total_seconds(), 300)
        self.assertEqual(job.max_instances, 1)


if __name__ == "__main__":
    unittest.main()
