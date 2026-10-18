import { useEffect, useState } from "react";
import { api, ApiError, Me } from "./api";
import { captureTokenFromUrl, clearToken, getToken } from "./auth";
import ChartPage from "./pages/ChartPage";
import AdminPage from "./pages/AdminPage";
import SummariesPage from "./pages/SummariesPage";

captureTokenFromUrl();

type State = { kind: "loading" } | { kind: "denied"; message: string } | { kind: "ok"; me: Me };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const path = window.location.pathname.replace(/\/+$/, "");
  const isAdminRoute = path === "/admin";
  const isSummariesRoute = path === "/summaries";

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

  return (
    <div className="shell">
      <header className="topbar">
        <span className="nav">
          <a href="/" className="brand">
            Stock Tracker
          </a>
          {state.kind === "ok" && (
            <span className="nav-links">
              <a href="/" className={isSummariesRoute ? "" : "active"}>
                Charts
              </a>
              <a href="/summaries" className={isSummariesRoute ? "active" : ""}>
                ✦ AI Summaries
              </a>
            </span>
          )}
        </span>
        {state.kind === "ok" && (
          <span className="who">
            {state.me.name}
            {state.me.role === "admin" && (
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
        </div>
      )}
      {state.kind === "ok" &&
        (isSummariesRoute ? (
          <SummariesPage isAdmin={state.me.role === "admin"} />
        ) : (
          <ChartPage isAdmin={state.me.role === "admin"} />
        ))}
    </div>
  );
}
