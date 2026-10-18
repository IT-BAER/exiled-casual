import { useState, type FormEvent } from "react";
import type { Me } from "@exiled/telemetry";
import { ApiError, call } from "./api";

/** Sign-in: user, password and a 6-digit code. One gilt action. */
export function Gate({ onSignedIn, bootError = null }: { onSignedIn: (me: Me) => void; bootError?: string | null }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(bootError && `The console API did not answer: ${bootError}`);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await call("POST /api/login", { body: { user, password, totp } }));
    } catch (err) {
      setPassword("");
      setTotp("");
      if (err instanceof ApiError && err.status === 401) setError("User, password or code is wrong.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts. Wait a minute, then try again.");
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="gate" id="main">
      <div className="gate-wrap">
        <img className="gate-logo" src="./textures/ui/menu/logo-512.webp" alt="Exiled Casual" width={512} height={172} />
        <div className="gate-card framed">
          <header className="page-head">
            <h1>Admin console</h1>
            <span className="divider" aria-hidden="true" />
            <p className="lede">Sign in with your password and the code from your authenticator.</p>
          </header>
          <form onSubmit={submit}>
            {error && (
              <p className="callout error" role="alert">
                {error}
              </p>
            )}
            <label>
              User
              <input name="user" autoComplete="username" required value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              Code
              <input
                name="totp"
                className="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            <button type="submit" className="primary wide" disabled={busy} aria-busy={busy}>
              Enter
            </button>
          </form>
          <p className="gate-foot">Admin console · private network</p>
        </div>
      </div>
    </main>
  );
}
