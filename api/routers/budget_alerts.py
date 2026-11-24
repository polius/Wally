from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select

from ..database import get_session
from ..models.budget_alerts import BudgetAlert, BudgetAlertPublic, BudgetAlertSettings
from ..services.budget_alerts import check_budget_alerts, get_warning_threshold, set_warning_threshold
from .auth import check_login


router = APIRouter(tags=["Budget Alerts"], dependencies=[Depends(check_login)])


@router.get("/budget-alerts", response_model=list[BudgetAlertPublic])
def read_budget_alerts(
    db: Annotated[Session, Depends(get_session)],
    include_dismissed: bool = False,
):
    query = select(BudgetAlert).order_by(BudgetAlert.created_at.desc(), BudgetAlert.id.desc())
    if not include_dismissed:
        query = query.where(BudgetAlert.dismissed == False)  # noqa: E712
    return db.exec(query).all()


@router.post("/budget-alerts/check", response_model=list[BudgetAlertPublic])
def run_budget_alert_check(db: Annotated[Session, Depends(get_session)]):
    # Same check the background job runs; useful to trigger it on demand.
    return check_budget_alerts(db)


@router.get("/budget-alerts/settings", response_model=BudgetAlertSettings)
def read_budget_alert_settings(db: Annotated[Session, Depends(get_session)]):
    return BudgetAlertSettings(warning_threshold=get_warning_threshold(db))


@router.put("/budget-alerts/settings", response_model=BudgetAlertSettings)
def update_budget_alert_settings(
    settings: BudgetAlertSettings,
    db: Annotated[Session, Depends(get_session)],
):
    set_warning_threshold(db, settings.warning_threshold)
    # Apply the new threshold right away instead of waiting for the next scheduled run.
    check_budget_alerts(db)
    return settings


@router.post("/budget-alerts/{alert_id}/dismiss", response_model=BudgetAlertPublic)
def dismiss_budget_alert(
    alert_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    alert = db.get(BudgetAlert, alert_id)

    if not alert:
        raise HTTPException(status_code=404, detail="This alert does not exist.")

    # Dismissed alerts are kept so the same threshold does not fire again this period.
    alert.dismissed = True
    db.add(alert)
    db.commit()
    db.refresh(alert)

    return alert
