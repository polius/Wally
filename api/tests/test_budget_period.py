import unittest
from datetime import date

from api.services.budget_period import current_window, in_window


class BudgetPeriodTests(unittest.TestCase):
    def test_monthly_uses_calendar_month(self):
        start, end = current_window("monthly", date(2026, 10, 15), date(2026, 10, 19))
        self.assertEqual(start, date(2026, 10, 1))
        self.assertEqual(end, date(2026, 10, 31))

    def test_weekly_first_window(self):
        start, end = current_window("weekly", date(2026, 10, 15), date(2026, 10, 19))
        self.assertEqual((start, end), (date(2026, 10, 15), date(2026, 10, 21)))

    def test_weekly_rollover_includes_next_month(self):
        start, end = current_window("weekly", date(2026, 10, 15), date(2026, 10, 31))
        self.assertEqual((start, end), (date(2026, 10, 29), date(2026, 11, 4)))

    def test_weekly_before_start_has_no_past_spending_window(self):
        start, end = current_window("weekly", date(2026, 10, 15), date(2026, 10, 10))
        self.assertEqual((start, end), (date(2026, 10, 15), date(2026, 10, 21)))
        self.assertFalse(in_window(date(2026, 10, 10), start, end))

    def test_window_edges_are_included(self):
        start, end = current_window("weekly", date(2026, 10, 15), date(2026, 10, 21))
        self.assertTrue(in_window(date(2026, 10, 15), start, end))
        self.assertTrue(in_window(date(2026, 10, 21), start, end))
        self.assertFalse(in_window(date(2026, 10, 22), start, end))


if __name__ == "__main__":
    unittest.main()