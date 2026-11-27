import type { AppState, NativeScreen, SyncStatus, UpdateState, WebNav } from "../shared/types";
import { BAR_HEIGHT } from "../shared/types";
import type { T } from "./i18n";
import { Alert, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, CloudCheck, CloudOff, Globe, Reload, Spinner } from "./icons";
import mark from "./lib/mark.svg";

/**
 * The window's title bar, in the manner of Claude's and UC Ultra's: a quiet
 * strip holding the window buttons, the web app's back / forward / reload,
 * a switch between IlmWays online and the offline work, the school with
 * the account menu, and on the right whether everything has reached the
 * server. Its empty parts drag the window; double-clicking zooms it.
 */
export function TopBar({
  state,
  update,
  sync,
  screen,
  webNav,
  version,
  t,
}: {
  state: AppState;
  update: UpdateState;
  sync: SyncStatus;
  /** What is showing: the web app (null) or one of the window's own screens. */
  screen: NativeScreen | null;
  webNav: WebNav;
  version: string;
  t: T;
}) {
  const platform = window.ilmways.platform;
  const signedIn = state.phase === "signed-in";
  const connection = state.phase === "starting" ? "checking" : state.connection;
  const offline = connection === "offline";
  const onWeb = signedIn && screen === null && !offline;

  return (
    <header
      dir="ltr"
      className="drag flex shrink-0 select-none items-center gap-1 border-b border-bar-line bg-bar text-[13px] text-ink"
      style={{
        height: BAR_HEIGHT,
        // Room for the window buttons: macOS draws them on the left, Windows over the right end.
        paddingLeft: platform === "darwin" ? 80 : 10,
        paddingRight: platform === "darwin" ? 10 : 146,
      }}
    >
      {signedIn ? (
        <>
          <BarButton label={t("back")} disabled={!onWeb || !webNav.canGoBack} onClick={() => window.ilmways.webBack()}>
            <ChevronLeft />
          </BarButton>
          <BarButton label={t("forward")} disabled={!onWeb || !webNav.canGoForward} onClick={() => window.ilmways.webForward()}>
            <ChevronRight />
          </BarButton>
          <BarButton label={t("reload")} disabled={!onWeb} onClick={() => window.ilmways.webReload()}>
            <Reload className="size-3.5" />
          </BarButton>

          {sync.available ? (
            <div className="no-drag ms-2 flex rounded-lg bg-bar-hover p-0.5" role="tablist">
              <Segment label={t("onlineApp")} active={screen === null && !offline} disabled={offline} onClick={() => window.ilmways.setScreen(null)}>
                <Globe className="size-3.5" />
              </Segment>
              <Segment label={t("offlineWork")} active={screen !== null || offline} onClick={() => window.ilmways.setScreen("home")}>
                <ClipboardCheck className="size-3.5" />
              </Segment>
            </div>
          ) : null}

          <span className="mx-2 h-4 w-px bg-bar-line" aria-hidden />

          <button
            type="button"
            title={t("accountMenu")}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              window.ilmways.openAccountMenu(
                { x: rect.left, y: rect.bottom + 4 },
                {
                  signOut: t("signOut"),
                  version: t("version", { version }),
                  waiting: sync.waiting > 0 ? t("waitingOnSignOut", { count: sync.waiting }) : undefined,
                },
              );
            }}
            className="no-drag flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-bar-hover"
          >
            <img src={mark} alt="" className="size-4" />
            <span className="max-w-72 truncate">{state.session.school?.name ?? "IlmWays"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted" />
          </button>
          {state.session.onlineOnly ? (
            <span className="hidden truncate text-xs text-muted lg:inline">{t("onlineOnly")}</span>
          ) : onWeb && webNav.title ? (
            <span className="hidden min-w-0 truncate text-muted lg:inline">{pageTitle(webNav.title)}</span>
          ) : null}
        </>
      ) : (
        <span className="flex items-center gap-2 px-1 font-medium">
          <img src={mark} alt="" className="size-4" />
          IlmWays
        </span>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        {update.status === "downloaded" ? (
          <button
            type="button"
            onClick={() => window.ilmways.installUpdate()}
            className="no-drag rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-white hover:brightness-110"
          >
            {t("updateReady")}
          </button>
        ) : update.status === "available" && typeof update.percent === "number" ? (
          <span className="text-xs text-muted">{t("updating", { percent: update.percent })}</span>
        ) : null}

        {signedIn && sync.available ? (
          <SyncIndicator sync={sync} offline={offline} t={t} />
        ) : (
          <ConnectionDot connection={connection} t={t} />
        )}
      </div>
    </header>
  );
}

/** "Attendance | IlmWays" → "Attendance". */
const pageTitle = (title: string) => title.replace(/\s*[|·—-]\s*IlmWays\s*$/i, "").trim();

function BarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="no-drag inline-flex size-7 items-center justify-center rounded-md text-muted transition hover:bg-bar-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Segment({ label, active, disabled, onClick, children }: { label: string; active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-6 w-8 items-center justify-center rounded-md transition disabled:opacity-35 ${
        active ? "bg-bar-active text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Whether everything done here has reached the server. Opens the offline work, where the details are. */
function SyncIndicator({ sync, offline, t }: { sync: SyncStatus; offline: boolean; t: T }) {
  const issues = sync.issues.length;
  const [icon, text, tone] = issues
    ? [<Alert key="i" className="size-3.5" />, t("syncIssues", { count: issues }), "text-red-600 dark:text-red-400"]
    : offline
      ? [<CloudOff key="i" className="size-3.5" />, sync.waiting ? t("offlineWaiting", { count: sync.waiting }) : t("offline"), "text-amber-700 dark:text-amber-400"]
      : sync.running
        ? [<Spinner key="i" className="size-3.5" />, t("syncing"), "text-muted"]
        : sync.waiting
          ? [<Reload key="i" className="size-3.5" />, t("syncWaiting", { count: sync.waiting }), "text-amber-700 dark:text-amber-400"]
          : [<CloudCheck key="i" className="size-3.5" />, t("syncUpToDate"), "text-muted"];
  return (
    <button
      type="button"
      role="status"
      onClick={() => window.ilmways.setScreen("home")}
      className={`no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-bar-hover ${tone}`}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}

function ConnectionDot({ connection, t }: { connection: "checking" | "online" | "offline"; t: T }) {
  const dot = connection === "online" ? "bg-emerald-500" : connection === "offline" ? "bg-amber-500" : "bg-slate-400";
  return (
    <span role="status" className="flex items-center gap-1.5 px-2 text-xs text-muted">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {t(connection)}
    </span>
  );
}
