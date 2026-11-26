from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select

from ..database import get_session
from ..models.subscription_alerts import SubscriptionPriceAlert, SubscriptionPriceAlertPublic
from ..services.subscription_alerts import check_subscription_price_alerts
from .auth import check_login


router = APIRouter(tags=["Subscription Alerts"], dependencies=[Depends(check_login)])


@router.get("/subscription-alerts", response_model=list[SubscriptionPriceAlertPublic])
def read_subscription_alerts(
    db: Annotated[Session, Depends(get_session)],
    include_dismissed: bool = False,
):
    query = select(SubscriptionPriceAlert).order_by(
        SubscriptionPriceAlert.charge_date.desc(), SubscriptionPriceAlert.id.desc()
    )
    if not include_dismissed:
        query = query.where(SubscriptionPriceAlert.dismissed == False)  # noqa: E712
    return db.exec(query).all()


@router.post("/subscription-alerts/check", response_model=list[SubscriptionPriceAlertPublic])
def run_subscription_alert_check(db: Annotated[Session, Depends(get_session)]):
    # Same check the background job runs; useful to trigger it on demand.
    return check_subscription_price_alerts(db)


@router.post("/subscription-alerts/{alert_id}/dismiss", response_model=SubscriptionPriceAlertPublic)
def dismiss_subscription_alert(
    alert_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    alert = db.get(SubscriptionPriceAlert, alert_id)

    if not alert:
        raise HTTPException(status_code=404, detail="This alert does not exist.")

    # Dismissed alerts are kept so the same charge does not alert again.
    alert.dismissed = True
    db.add(alert)
    db.commit()
    db.refresh(alert)

    return alert
