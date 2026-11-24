from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from api.database import get_session
from api.models.recurring_transactions import RecurringTransaction
from api.services.subscriptions import subscription_summary

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])


@router.get("/summary")
def get_subscription_summary(db: Session = Depends(get_session)):
    recurring = db.exec(select(RecurringTransaction)).all()
    return subscription_summary(recurring)