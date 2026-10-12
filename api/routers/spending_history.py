from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session

from ..database import get_session
from ..models.categories import Category
from ..services.spending_history import get_spending_history
from .auth import check_login


class MonthlySpending(BaseModel):
    month: str
    amount: Decimal


class SpendingHistoryResponse(BaseModel):
    category: str
    window_start: date
    window_end_exclusive: date
    history: list[MonthlySpending]


def get_today() -> date:
    return date.today()


router = APIRouter(
    tags=["Spending history"],
    dependencies=[Depends(check_login)],
)


@router.get(
    "/spending-history",
    response_model=SpendingHistoryResponse,
)
def read_spending_history(
    category: Annotated[str, Query(min_length=1)],
    db: Annotated[Session, Depends(get_session)],
    today: Annotated[date, Depends(get_today)],
    months: Annotated[int, Query(ge=1, le=6)] = 6,
):
    if db.get(Category, category) is None:
        raise HTTPException(
            status_code=404,
            detail="This category does not exist.",
        )

    return get_spending_history(
        db=db,
        category=category,
        today=today,
        months=months,
    )