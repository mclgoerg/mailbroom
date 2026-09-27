import { useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { AuthMode } from "../types";
import { Button, Input, Spinner } from "./ui";

/** Full-page gate shown while the API demands a login. */
export function Login({ mode, onLogin }: {
  mode: AuthMode;
  onLogin: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onLogin();
    } catch (err: any) {
      setError(String(err.message ?? err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-24 max-w-xs rounded-xl border border-line
      bg-panel p-6 text-sm">
      <div className="mb-4 text-center text-base font-bold tracking-tight">
        Mailbroom
      </div>
      {mode === "password" && (
        <form onSubmit={submit} className="space-y-3">
          <Input className="w-full" type="password" autoFocus
            placeholder={t("Password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)} />
          <Button className="w-full" disabled={busy || !password}>
            {busy ? <Spinner size="sm" className="!text-white" />
              : t("login.submit")}
          </Button>
        </form>
      )}
      {mode === "oidc" && (
        <a href="/api/oidc/login"
          className="block rounded-md bg-accent px-3 py-2 text-center
            font-medium text-white hover:bg-accenth">
          {t("login.sso")}
        </a>
      )}
      {error && (
        <div className="mt-3 text-center text-xs text-rose-400">{error}</div>
      )}
    </div>
  );
}
