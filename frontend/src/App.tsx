import { useEffect, useState } from "react";
import { api, ApiError, Me } from "./api";
import { captureTokenFromUrl, clearToken, getToken } from "./auth";
import ChartPage from "./pages/ChartPage";
import AdminPage from "./pages/AdminPage";

captureTokenFromUrl();

type State = { kind: "loading" } | { kind: "denied"; message: string } | { kind: "ok"; me: Me };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

  const refresh = () => {
    if (!getToken()) {
      setState({ kind: "denied", message: "You need an access link to use this site." });
      return;
    }
    api
      .me()
      .then((me) => setState({ kind: "ok", me }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) clearToken();
        setState({ kind: "denied", message: e.message });
      });
  };

  useEffect(refresh, []);

  if (isAdminRoute) return <AdminPage onAuthChange={refresh} me={state.kind === "ok" ? state.me : null} />;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand">
          Mean Reversion Tracker
        </a>
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
      {state.kind === "ok" && <ChartPage />}
    </div>
  );
}
