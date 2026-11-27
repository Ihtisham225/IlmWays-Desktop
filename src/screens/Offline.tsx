import { useState } from "react";
import type { translator, Locale } from "../i18n";

type T = ReturnType<typeof translator>;

/**
 * Shown instead of the web app while the server can't be reached. Phase 2
 * has no offline workflows yet; this says so plainly, and when they arrive
 * (attendance, fees, registration, marks) they are listed here to open.
 */
export function Offline({ lastContact, locale, t }: { lastContact: string; locale: Locale; t: T }) {
  const [retrying, setRetrying] = useState(false);
  const when = new Date(lastContact).toLocaleString(locale === "en" ? undefined : locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-50 text-2xl" aria-hidden>
          ⚡
        </div>
        <h1 className="text-xl font-semibold">{t("offlineTitle")}</h1>
        <p className="text-sm text-muted">{t("offlineBody")}</p>
        <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-ink">{t("offlineSoon")}</p>
        <p className="text-xs text-muted">{t("lastContact", { time: when })}</p>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await window.ilmways.retryConnection();
            setRetrying(false);
          }}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
        >
          {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}
