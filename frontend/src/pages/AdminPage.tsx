import { FormEvent, useEffect, useState } from "react";
import { api, Me, ShareLink } from "../api";
import { setToken } from "../auth";

interface Props {
  me: Me | null;
  onAuthChange: () => void;
}

export default function AdminPage({ me, onAuthChange }: Props) {
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<ShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me?.role === "admin";
  const createdUrl = created?.token ? `${window.location.origin}/?t=${created.token}` : null;

  const refresh = () => api.listLinks().then(setLinks).catch((e) => setError(e.message));

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    try {
      const who = await api.me(key.trim());
      if (who.role !== "admin") throw new Error("That is a viewer link, not the admin key.");
      setToken(key.trim());
      setKey("");
      onAuthChange();
    } catch (err) {
      setKeyError((err as Error).message);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const link = await api.createLink(name.trim());
      setCreated(link);
      setName("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revoke = async (link: ShareLink) => {
    if (!window.confirm(`Revoke access for "${link.name}"? Their link will stop working immediately.`)) return;
    try {
      await api.revokeLink(link.id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand">
          Mean Reversion Tracker
        </a>
        <span className="who">Share links</span>
      </header>

      {!isAdmin && (
        <form className="card admin-login" onSubmit={signIn}>
          <h2>Admin sign-in</h2>
          <label>
            <span>Admin key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
          </label>
          <button type="submit">Continue</button>
          {keyError && <p className="error-text">{keyError}</p>}
        </form>
      )}

      {isAdmin && (
        <main>
          <form className="card ticker-form" onSubmit={create}>
            <label>
              <span>New share link for</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person's name" required />
            </label>
            <button type="submit">Create link</button>
          </form>

          {createdUrl && created && (
            <div className="card created">
              <p>
                Link for <strong>{created.name}</strong> — copy it now, it won't be shown again:
              </p>
              <div className="copy-row">
                <input readOnly value={createdUrl} onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => navigator.clipboard?.writeText(createdUrl)}>
                  Copy
                </button>
              </div>
            </div>
          )}

          {error && <div className="card error">{error}</div>}

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No share links yet.
                    </td>
                  </tr>
                )}
                {links.map((l) => (
                  <tr key={l.id} className={l.revoked ? "revoked" : ""}>
                    <td>{l.name}</td>
                    <td>{new Date(l.created_at).toLocaleString()}</td>
                    <td>{l.last_used_at ? new Date(l.last_used_at).toLocaleString() : "Never"}</td>
                    <td>{l.revoked ? "Revoked" : "Active"}</td>
                    <td>
                      {!l.revoked && (
                        <button type="button" className="danger" onClick={() => revoke(l)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      )}
    </div>
  );
}
