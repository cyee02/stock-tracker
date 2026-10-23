"""Price alerts: a Web Push notification when a watched ticker crosses a mean-reversion line.

Every few minutes a background thread takes each watchlist ticker's live price
and compares it with the 1-year moving average and 25th/75th percentile lines.
When the price has moved to the other side of a line since the last check, every
subscribed device (the home-screen app on a phone, a browser on a laptop) gets a
notification.
"""

import base64
import datetime as dt
import json
import logging
import threading
from dataclasses import dataclass

import yfinance as yf
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush

from app.db import Database
from app.market import WATCH_WINDOW, compute_bands

log = logging.getLogger(__name__)

LINES = {"p25": "25th percentile", "ma": "moving average", "p75": "75th percentile"}
# The price must clear a line by this fraction before it counts as on the other
# side, so a price hovering on the line doesn't alert every few minutes.
BAND = 0.002
# After an alert, the same line on the same ticker stays quiet this long.
COOLDOWN = dt.timedelta(hours=3)


@dataclass
class Crossing:
    line: str
    direction: str  # "above" | "below"
    level: float


def side_of(price: float, level: float, previous: int | None) -> int | None:
    """1 above the line, -1 below; inside the band, whatever it was before (None if unknown)."""
    if price > level * (1 + BAND):
        return 1
    if price < level * (1 - BAND):
        return -1
    return previous


def detect_crossings(
    price: float, levels: dict[str, float | None], state: dict[str, dict], now: dt.datetime
) -> tuple[dict[str, dict], list[Crossing]]:
    """New per-line state and the crossings worth an alert.

    The first time a line is seen there is nothing to compare with, so it only
    records the side. A cross inside a line's cooldown updates the side quietly.
    """
    new_state: dict[str, dict] = {}
    crossings = []
    for line, level in levels.items():
        if level is None:
            continue
        prev = state.get(line, {})
        side = side_of(price, level, prev.get("side"))
        if side is None:
            continue
        notified_at = prev.get("notified_at")
        if prev.get("side") is not None and side != prev["side"]:
            last = dt.datetime.fromisoformat(notified_at) if notified_at else None
            if last is None or now - last >= COOLDOWN:
                crossings.append(Crossing(line, "above" if side > 0 else "below", level))
                notified_at = now.isoformat(timespec="seconds")
        new_state[line] = {"side": side, "notified_at": notified_at}
    return new_state, crossings


SIGNAL_AFTER = {
    ("p75", "above"): "now overpriced",
    ("p75", "below"): "back within its range",
    ("p25", "below"): "now underpriced",
    ("p25", "above"): "back within its range",
    ("ma", "above"): "above its 1-year average",
    ("ma", "below"): "below its 1-year average",
}


def message(ticker: str, price: float, currency: str | None, crossings: list[Crossing]) -> dict:
    cur = f" {currency}" if currency else ""
    # In the order the price passed them: highest first when falling, lowest first when rising.
    falling = crossings[0].direction == "below"
    ordered = sorted(crossings, key=lambda c: c.level, reverse=falling)
    names = [LINES[c.line] for c in ordered]
    joined = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    last = ordered[-1]
    levels = "; ".join(f"{LINES[c.line]} {c.level:,.2f}" for c in ordered)
    return {
        "title": f"{ticker} {'fell below' if falling else 'rose above'} the {joined}",
        "body": f"{price:,.2f}{cur}, {SIGNAL_AFTER[(last.line, last.direction)]} ({levels}).",
        "url": f"/?ticker={ticker}&strategy=mean-reversion",
        "tag": f"{ticker}-{last.line}",
    }


def live_price(ticker: str) -> float | None:
    """Latest traded price; during market hours this is intraday, not the last close."""
    try:
        v = yf.Ticker(ticker).fast_info["last_price"]
        return float(v) if v else None
    except Exception as exc:
        log.info("no live price for %s: %s", ticker, exc)
        return None


# --- Web Push -----------------------------------------------------------------

VAPID_KEY = "vapid_private_pem"
SUBJECT_KEY = "vapid_subject"


def vapid(db: Database) -> Vapid01:
    """This server's push identity, made on first use and kept in the database."""
    pem = db.get_kv(VAPID_KEY)
    if pem is None:
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        db.set_kv(VAPID_KEY, pem)
    return Vapid01.from_pem(pem.encode())


def public_key(db: Database) -> str:
    """The key browsers need to subscribe (base64url, uncompressed point)."""
    raw = vapid(db).public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def send_push(db: Database, sub: dict, payload: dict) -> bool:
    """Deliver one notification. Drops subscriptions the push service says are gone."""
    # Apple rejects a contact claim that isn't a real https URL or address, so
    # use the site's own address, recorded when a device subscribed.
    subject = db.get_kv(SUBJECT_KEY) or "https://localhost"
    try:
        webpush(
            {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
            data=json.dumps(payload),
            vapid_private_key=vapid(db),
            vapid_claims={"sub": subject},
            ttl=6 * 3600,
            headers={"Urgency": "high"},
            timeout=15,
        )
        return True
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            log.info("push subscription expired, removing: %s", sub["endpoint"][:60])
            db.delete_subscription(sub["endpoint"])
        else:
            log.warning("push failed (%s): %s", status, exc)
        return False
    except Exception as exc:  # network trouble reaching the push service
        log.warning("push failed: %s", exc)
        return False


def broadcast(db: Database, payload: dict, pusher=send_push) -> int:
    return sum(pusher(db, sub, payload) for sub in db.list_subscriptions())


# --- The checker ----------------------------------------------------------------


class AlertChecker:
    """Checks the watchlist on a timer in a daemon thread."""

    def __init__(self, app, interval: int, price_loader=live_price, pusher=send_push):
        self.app = app
        self.interval = interval
        self.price_loader = price_loader
        self.pusher = pusher
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_run: dt.datetime | None = None

    def start(self) -> None:
        if self.interval <= 0 or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, name="price-alerts", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:
                log.exception("price-alert check failed")
            self._stop.wait(self.interval)

    def run_once(self, now: dt.datetime | None = None) -> int:
        """Check every watched ticker once; returns how many alerts went out."""
        db: Database = self.app.state.db
        now = now or dt.datetime.now(dt.timezone.utc)
        sent = 0
        # Runs even with no device subscribed, so the sides stay current and
        # turning alerts on later doesn't fire for crosses in the meantime.
        for ticker in db.list_watchlist():
            try:
                sent += self._check(db, ticker, now)
            except Exception as exc:
                log.info("alert check for %s failed: %s", ticker, exc)
        self.last_run = now
        return sent

    def _check(self, db: Database, ticker: str, now: dt.datetime) -> int:
        from app.routes.watchlist import _start  # same history span the watchlist loads

        history = self.app.state.history.get(ticker, _start())
        close = history.close.dropna()
        if len(close) < WATCH_WINDOW:
            return 0
        last = compute_bands(close, WATCH_WINDOW).iloc[-1]
        levels = {line: float(last[line]) for line in LINES}
        price = self.price_loader(ticker) or float(close.iloc[-1])
        state, crossings = detect_crossings(price, levels, db.alert_state(ticker), now)
        db.set_alert_state(ticker, state)
        if not crossings:
            return 0
        for c in crossings:
            db.add_alert_event(ticker, c.line, c.direction, price, c.level, history.currency)
        log.info("alert: %s %s", ticker, [(c.line, c.direction) for c in crossings])
        broadcast(db, message(ticker, price, history.currency, crossings), self.pusher)
        return 1


def start_checker(app) -> AlertChecker:
    checker = AlertChecker(
        app,
        app.state.settings.alert_interval_seconds,
        price_loader=app.state.price_loader,
        pusher=app.state.pusher,
    )
    checker.start()
    return checker

