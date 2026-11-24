import unittest
from datetime import date
from decimal import Decimal

from api.services.budget_forecast import forecast_month_end

class ForecastTests(unittest.TestCase):
    def test_monthly_linear_projection(self):
        # 150 spent in 15 days over a 31-day window → 150/15*31 = 310.00
        result = forecast_month_end(
            Decimal("150"), date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 15))
        self.assertEqual(result, Decimal("310.00"))

    def test_weekly_linear_projection(self):
        # 100 spent in 4 days out of 7 → 100/4*7 = 175.00
        result = forecast_month_end(
            Decimal("100"), date(2026, 10, 15), date(2026, 10, 21), date(2026, 10, 18))
        self.assertEqual(result, Decimal("175.00"))

    def test_no_spending_returns_none(self):
        result = forecast_month_end(
            Decimal("0"), date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 15))
        self.assertIsNone(result)

    def test_first_day_returns_none(self):
        result = forecast_month_end(
            Decimal("40"), date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 1))
        self.assertIsNone(result)

    def test_last_day_returns_spent(self):
        result = forecast_month_end(
            Decimal("200"), date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 31))
        self.assertEqual(result, Decimal("200"))

    def test_period_not_started_returns_none(self):
        result = forecast_month_end(
            Decimal("50"), date(2026, 11, 1), date(2026, 11, 30), date(2026, 10, 15))
        self.assertIsNone(result)