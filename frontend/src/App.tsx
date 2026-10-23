import { MouseEvent, useEffect, useState } from "react";
import { api, ApiError, Me } from "./api";
import { captureTokenFromUrl, clearToken, getToken, setToken } from "./auth";
import ChartPage from "./pages/ChartPage";
import AdminPage from "./pages/AdminPage";
import SummariesPage from "./pages/SummariesPage";
import WatchlistPage from "./pages/WatchlistPage";
import { currentRoute, isAppLink, navigate, onNavigate, rememberChart, restoreLastChart, Route } from "./router";

captureTokenFromUrl();
restoreLastChart();

type State = { kind: "loading" } | { kind: "denied"; message: string } | { kind: "ok"; me: Me };

const NAV: { route: Route; label: string }[] = [
  { route: "/", label: "Charts" },
  { route: "/watchlist", label: "★ Watchlist" },
  { route: "/summaries", label: "✦ AI Summaries" },
];

/** Follow links to app pages without a reload; anything else (new tab, other sites, /admin) as usual. */
function interceptLinks(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as HTMLElement).closest("a");
  if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  const url = new URL(a.href);
  if (!isAppLink(url)) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [route, setRoute] = useState<Route>(currentRoute());
  // Bumped on every navigation, so the Charts page can pick up a ticker from the URL.
  const [navCount, setNavCount] = useState(0);
  const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

  useEffect(
    () =>
      onNavigate(() => {
        setRoute(currentRoute());
        setNavCount((n) => n + 1);
      }),
    [],
  );

  // The installed iPhone app can be closed from the background at any time; keep the last ticker.
  useEffect(() => {
    const save = () => document.visibilityState === "hidden" && rememberChart();
    document.addEventListener("visibilitychange", save);
    return () => document.removeEventListener("visibilitychange", save);
  }, []);

  // Charts drawn while the page was hidden have no width; let Plotly re-measure.
  useEffect(() => {
    if (route === "/") window.dispatchEvent(new Event("resize"));
  }, [route]);

  // Always ask the server who we are. Behind Tailscale there is no token to
  // check locally -- the tailnet identifies us -- so only the server can say.
  const refresh = () => {
    const hadToken = getToken() !== null;
    api
      .me()
      .then((me) => setState({ kind: "ok", me }))
      .catch((e) => {
        const unauthorized = e instanceof ApiError && e.status === 401;
        if (unauthorized) clearToken();
        setState({
          kind: "denied",
          message: unauthorized && !hadToken ? "You need an access link to use this site." : e.message,
        });
      });
  };

  useEffect(refresh, []);

  if (isAdminRoute) return <AdminPage onAuthChange={refresh} me={state.kind === "ok" ? state.me : null} />;

  const isAdmin = state.kind === "ok" && state.me.role === "admin";
  return (
    <div className="shell" onClick={interceptLinks}>
      <header className="topbar">
        <span className="nav">
          <a href="/" className="brand">
            Stock Tracker
          </a>
          {state.kind === "ok" && (
            <span className="nav-links">
              {NAV.map((n) => (
                <a key={n.route} href={n.route} className={route === n.route ? "active" : ""}>
                  {n.label}
                </a>
              ))}
            </span>
          )}
        </span>
        {state.kind === "ok" && (
          <span className="who">
            {state.me.name}
            {isAdmin && (
              <>
                {" · "}
                <a href="/admin">Manage links</a>
              </>
            )}
          </span>
        )}
      </header>
      {state.kind === "loading" && <p className="muted">Checking access…</p>}
      {state.kind === "denied" && (
        <div className="card denied">
          <h2>Access required</h2>
          <p>{state.message}</p>
          <p className="muted">Ask the owner for a share link.</p>
          <LinkForm onSaved={refresh} />
        </div>
      )}
      {state.kind === "ok" && (
        <>
          {/* Stays mounted while other pages show, so the ticker and chart are kept. */}
          <div hidden={route !== "/"}>
            <ChartPage isAdmin={isAdmin} active={route === "/"} navCount={navCount} />
          </div>
          {route === "/watchlist" && <WatchlistPage isAdmin={isAdmin} />}
          {route === "/summaries" && <SummariesPage isAdmin={isAdmin} />}
        </>
      )}
    </div>
  );
}

/**
 * Paste a share link (or bare token). An app added to the iPhone home screen
 * doesn't share storage with Safari, so a link opened there isn't remembered here.
 */
function LinkForm({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    let token = text;
    try {
      token = new URL(text).searchParams.get("t") ?? text;
    } catch {
      /* not a URL: treat it as the token itself */
    }
    if (!token) return;
    setToken(token);
    onSaved();
  };
  return (
    <form className="link-form" onSubmit={submit}>
      <label>
        <span>Have a link? Paste it here</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…/?t=…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" disabled={!value.trim()}>
        Open
      </button>
    </form>
  );
}
