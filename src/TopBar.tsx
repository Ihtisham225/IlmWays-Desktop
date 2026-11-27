import type { AppState, UpdateState } from "../shared/types";
import type { translator } from "./i18n";
import { BAR_HEIGHT } from "../shared/types";
import mark from "./lib/mark.svg";

type T = ReturnType<typeof translator>;

/**
 * The window's title bar: who and where, whether the internet is there, an
 * update waiting, and signing out. On macOS it leaves room for the window
 * buttons; the whole bar drags the window.
 */
export function TopBar({ state, update, t }: { state: AppState; update: UpdateState; t: T }) {
  const mac = window.ilmways.platform === "darwin";
  const connection = state.phase === "starting" ? "checking" : state.connection;
  const signedIn = state.phase === "signed-in";

  return (
    <header
      className="drag flex shrink-0 items-center gap-3 border-b border-line bg-white px-3 text-sm"
      style={{ height: BAR_HEIGHT, paddingInlineStart: mac ? 84 : 12 }}
    >
      <img src={mark} alt="" className="size-6" />
      <span className="truncate font-semibold">
        {signedIn ? (state.session.school?.name ?? "IlmWays") : "IlmWays"}
      </span>
      {signedIn && state.session.onlineOnly ? (
        <span className="hidden rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand sm:inline">{t("onlineOnly")}</span>
      ) : null}

      <div className="ms-auto flex items-center gap-2">
        {update.status === "downloaded" ? (
          <button
            type="button"
            onClick={() => window.ilmways.installUpdate()}
            className="no-drag rounded-full bg-brand px-3 py-1 text-xs font-medium text-white hover:brightness-110"
          >
            {t("updateReady")}
          </button>
        ) : update.status === "available" && typeof update.percent === "number" ? (
          <span className="text-xs text-muted">{t("updating", { percent: update.percent })}</span>
        ) : null}

        <ConnectionChip connection={connection} t={t} />

        {signedIn ? (
          <>
            <span className="hidden max-w-48 truncate text-xs text-muted md:inline">{state.session.user.name}</span>
            <button
              type="button"
              onClick={() => void window.ilmways.logout()}
              className="no-drag rounded-md px-2 py-1 text-xs text-muted hover:bg-brand-soft hover:text-ink"
            >
              {t("signOut")}
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}

function ConnectionChip({ connection, t }: { connection: "checking" | "online" | "offline"; t: T }) {
  const style =
    connection === "online"
      ? "bg-emerald-50 text-emerald-700"
      : connection === "offline"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-muted";
  const dot = connection === "online" ? "bg-emerald-500" : connection === "offline" ? "bg-amber-500" : "bg-slate-400";
  return (
    <span role="status" className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${style}`}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {t(connection)}
    </span>
  );
}
