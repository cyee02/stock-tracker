from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.alerts import SUBJECT_KEY, LINES, broadcast, public_key
from app.auth import Viewer, require_admin

router = APIRouter(prefix="/api/alerts")


class Keys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class Subscription(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)
    keys: Keys
    device: str | None = Field(None, max_length=100)


class Endpoint(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)


@router.get("")
def config(request: Request, _: Viewer = Depends(require_admin)):
    """What a device needs to subscribe, plus the devices already subscribed and recent alerts."""
    db = request.app.state.db
    checker = getattr(request.app.state, "alert_checker", None)
    return {
        "public_key": public_key(db),
        "interval_seconds": request.app.state.settings.alert_interval_seconds,
        "last_check": checker.last_run.isoformat(timespec="seconds") if checker and checker.last_run else None,
        "devices": [{"endpoint": s["endpoint"], "device": s["device"]} for s in db.list_subscriptions()],
        "events": [{**e, "line_label": LINES.get(e["line"], e["line"])} for e in db.list_alert_events()],
    }


@router.post("/subscriptions", status_code=204)
def subscribe(request: Request, body: Subscription, _: Viewer = Depends(require_admin)):
    if not body.endpoint.startswith("https://"):
        raise HTTPException(422, "Push endpoints must be https")
    db = request.app.state.db
    origin = request.headers.get("origin", "")
    if origin.startswith("https://"):
        db.set_kv(SUBJECT_KEY, origin)
    db.save_subscription(body.endpoint, body.keys.p256dh, body.keys.auth, body.device)


@router.post("/subscriptions/remove", status_code=204)
def unsubscribe(request: Request, body: Endpoint, _: Viewer = Depends(require_admin)):
    request.app.state.db.delete_subscription(body.endpoint)


@router.post("/test")
def test(request: Request, _: Viewer = Depends(require_admin)):
    """Send a sample notification to every subscribed device."""
    db = request.app.state.db
    if not db.list_subscriptions():
        raise HTTPException(422, "No device has alerts turned on")
    sent = broadcast(
        db,
        {
            "title": "Price alerts are on",
            "body": "You'll get a notification like this when a watched ticker crosses a mean-reversion line.",
            "url": "/watchlist",
            "tag": "test",
        },
        request.app.state.pusher,
    )
    return {"sent": sent, "devices": len(db.list_subscriptions())}
