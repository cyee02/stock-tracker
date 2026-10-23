/**
 * Navigation inside the app without reloading the page, so the Charts page
 * (ticker, chart, tab) is still there after a visit to another page.
 */

export const ROUTES = ["/", "/watchlist", "/summaries"] as const;
export type Route = (typeof ROUTES)[number];

const LAST_CHART_KEY = "stock-tracker-last-chart";
const NAV_EVENT = "app:navigate";

export function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : "/";
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Remember the Charts page's query (ticker, tab, …) for coming back to it, also after a relaunch. */
export function rememberChart(): void {
  if (currentRoute() !== "/") return;
  const search = window.location.search;
  if (new URLSearchParams(search).get("ticker")) storage()?.setItem(LAST_CHART_KEY, search);
}

export function lastChartSearch(): string {
  return storage()?.getItem(LAST_CHART_KEY) ?? "";
}

/**
 * On startup at a bare "/", reopen the last ticker. Matters most for the
 * home-screen app, which always launches at "/".
 */
export function restoreLastChart(): void {
  if (currentRoute() !== "/" || window.location.search) return;
  const search = lastChartSearch();
  if (search) window.history.replaceState(null, "", `/${search}`);
}

/** Whether a link points at a page this app renders itself. */
export function isAppLink(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return url.origin === window.location.origin && (ROUTES as readonly string[]).includes(path);
}

/**
 * Go to an app page. A bare "/" returns to the chart as it was left; "/?ticker=X"
 * opens that ticker.
 */
export function navigate(href: string): void {
  rememberChart();
  const url = new URL(href, window.location.origin);
  if ((url.pathname === "/" || url.pathname === "") && !url.search) url.search = lastChartSearch();
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.pushState(null, "", next);
  }
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0 });
}

/** Run `handler` after every in-app navigation and every browser back/forward. */
export function onNavigate(handler: () => void): () => void {
  window.addEventListener(NAV_EVENT, handler);
  window.addEventListener("popstate", handler);
  return () => {
    window.removeEventListener(NAV_EVENT, handler);
    window.removeEventListener("popstate", handler);
  };
}
