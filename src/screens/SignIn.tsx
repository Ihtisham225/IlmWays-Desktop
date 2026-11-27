import { useState } from "react";
import type { Connection, SignedOutNotice } from "../../shared/types";
import type { T } from "../i18n";
import mark from "../lib/mark.svg";


const NOTICE = { revoked: "noticeRevoked", expired: "noticeExpired", "signed-out-on-web": "noticeSignedOutOnWeb" } as const;

/**
 * Sign-in needs the internet (D4): the password is checked by the server,
 * and no password is ever kept on the PC. Once signed in, the PC keeps
 * working offline for up to 30 days without reaching the server.
 */
export function SignIn({ connection, notice, t }: { connection: Connection; notice?: SignedOutNotice; t: T }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offline = connection === "offline";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await window.ilmways.login(identifier.trim(), password);
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-brand-soft/60 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-raised p-7 shadow-sm">
        <div className="space-y-2 text-center">
          <img src={mark} alt="" className="mx-auto size-12" />
          <h1 className="text-lg font-semibold">{t("signInTitle")}</h1>
          <p className="text-sm text-muted">{t("signInHint")}</p>
        </div>

        {notice ? <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-ink">{t(NOTICE[notice])}</p> : null}
        {offline ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {t("needInternet")}
          </p>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("loginId")}</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            dir="ltr"
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            dir="ltr"
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || offline}
          className="w-full rounded-md bg-brand px-3 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? t("signingIn") : t("signIn")}
        </button>
        {offline ? (
          <button type="button" onClick={() => void window.ilmways.retryConnection()} className="w-full text-sm text-brand hover:underline">
            {t("tryAgain")}
          </button>
        ) : null}
      </form>
    </div>
  );
}
