import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from api.database import get_session
from api.models.categories import Category
from api.routers.auth import check_login
from api.routers.budgets import router as budgets_router

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
test_app.include_router(budgets_router)

test_app.dependency_overrides[get_session] = get_test_session
test_app.dependency_overrides[check_login] = skip_login

client = TestClient(test_app)

class BudgetAPITests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        SQLModel.metadata.create_all(test_engine)

        with Session(test_engine) as session:
            session.add(Category(name="Food"))
            session.commit()

    @classmethod
    def tearDownClass(cls):
        SQLModel.metadata.drop_all(test_engine)

    def test_budget_crud(self):
        # Create
        response = client.post(
            "/budgets",
            json={
                "category": "Food",
                "limit": 400,
                "period": "monthly",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["category"], "Food")
        self.assertEqual(response.json()["limit"], "400.00")
        self.assertEqual(response.json()["period"], "monthly")

        # Read
        response = client.get("/budgets/Food")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["category"], "Food")

        # Update
        response = client.put(
            "/budgets/Food",
            json={
                "limit": 100,
                "period": "weekly",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["limit"], "100.00")
        self.assertEqual(response.json()["period"], "weekly")

        # Delete
        response = client.delete("/budgets/Food")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

        # Confirm deletion
        response = client.get("/budgets/Food")

        self.assertEqual(response.status_code, 404)
    def test_reject_negative_limit(self):
        response = client.post(
            "/budgets",
            json={
                "category": "Food",
                "limit": -100,
                "period": "monthly",
            },
        )

        self.assertEqual(response.status_code, 422)


    def test_reject_invalid_period(self):
        response = client.post(
            "/budgets",
            json={
                "category": "Food",
                "limit": 400,
                "period": "yearly",
            },
        )

        self.assertEqual(response.status_code, 422)


    def test_reject_nonexistent_category(self):
        response = client.post(
            "/budgets",
            json={
                "category": "NotARealCategory",
                "limit": 400,
                "period": "monthly",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"],
            "This category does not exist.",
        )
    def test_reject_duplicate_budget(self):
        first_response = client.post(
            "/budgets",
            json={
                "category": "Food",
                "limit": 400,
                "period": "monthly",
            },
        )

        self.assertEqual(first_response.status_code, 200)

        second_response = client.post(
            "/budgets",
            json={
                "category": "Food",
                "limit": 100,
                "period": "weekly",
            },
        )

        self.assertEqual(second_response.status_code, 400)
        self.assertEqual(
            second_response.json()["detail"],
            "A budget for this category already exists.",
        )

        # Clean up so this test does not affect other tests.
        client.delete("/budgets/Food")