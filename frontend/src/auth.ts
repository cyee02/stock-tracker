const TOKEN_KEY = "stock-tracker-token";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Move a `?t=` token from the URL into localStorage so it isn't left in the address bar. */
export function captureTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("t");
  if (!token) return;
  setToken(token);
  url.searchParams.delete("t");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string): void {
  storage()?.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  storage()?.removeItem(TOKEN_KEY);
}
