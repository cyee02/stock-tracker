/** Web Push for price alerts: register the service worker, subscribe this device. */
import { api } from "./api";

export type PushSupport =
  | "supported"
  /** iPhone/iPad Safari tab: push only works in the app opened from the Home Screen icon. */
  | "ios-needs-home-screen"
  | "unsupported";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIOS() && !isStandalone()) return "ios-needs-home-screen";
  return ok ? "supported" : "unsupported";
}

/** A name for this device in the list of subscribed devices. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || isIOS() ? "iPad" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : "Device";
  if (device === "iPhone" || device === "iPad") return `${device} (Home Screen app)`;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${device} · ${browser}`;
}

export function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* alerts just won't be available */
    });
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** This device's current subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Ask for permission and subscribe this device. Must start from a tap or click:
 * Safari only shows the permission prompt in response to one.
 */
export async function enableAlerts(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in Settings (iPhone: Settings → Notifications → Stocks) and try again."
        : "Notifications weren't allowed.",
    );
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  const json = sub.toJSON();
  await api.subscribeAlerts({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    device: deviceName(),
  });
}

export async function disableAlerts(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.unsubscribeAlerts(sub.endpoint);
  await sub.unsubscribe();
}
