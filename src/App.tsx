import { useEffect, useState } from "react";
import type { AppState, NativeScreen, SyncStatus, UpdateState, WebNav } from "../shared/types";
import { translator, type Locale } from "./i18n";
import { TopBar } from "./TopBar";
import { SignIn } from "./screens/SignIn";
import { Home } from "./screens/Home";
import { Attendance } from "./screens/Attendance";
import mark from "./lib/mark.svg";

const NO_SYNC: SyncStatus = { available: false, running: false, firstSyncDone: false, downloaded: 0, waiting: 0, issues: [], lastSynced: null, error: null };

/**
 * The window's own page. It never holds the device token or talks to the
 * server: the main process does that and tells this page the state. While
 * the web app is showing, the main process draws it under the bar and this
 * page shows only the bar; otherwise it shows the offline work.
 */
export function App({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, setState] = useState<AppState>({ phase: "starting" });
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [sync, setSync] = useState<SyncStatus>(NO_SYNC);
  const [screen, setScreen] = useState<NativeScreen | null>(null);
  const [webNav, setWebNav] = useState<WebNav>({ canGoBack: false, canGoForward: false, title: "" });
  const [version, setVersion] = useState("");

  useEffect(() => {
    const api = window.ilmways;
    void api.getState().then(setState);
    void api.getUpdateState().then(setUpdate);
    void api.getSyncStatus().then(setSync);
    void api.appVersion().then(setVersion);
    const off = [api.onState(setState), api.onUpdateState(setUpdate), api.onSyncStatus(setSync), api.onScreen(setScreen), api.onWebNav(setWebNav)];
    return () => off.forEach((stop) => stop());
  }, []);

  const signedIn = state.phase === "signed-in";
  const offline = signedIn && state.connection === "offline";
  const canAttendance = signedIn && state.session.permissions.some((p) => p === "attendance.view" || p === "attendance.mark");
  // Offline, the offline work shows by itself; online, when chosen from the bar.
  const native: NativeScreen | null = signedIn && sync.available ? (screen ?? (offline ? "home" : null)) : null;

  return (
    <div className="flex h-full flex-col">
      <TopBar state={state} update={update} sync={sync} screen={native} webNav={webNav} version={version} t={t} />
      <main className="min-h-0 flex-1 overflow-auto">
        {state.phase === "starting" ? (
          <Opening label={t("loading")} />
        ) : state.phase === "signed-out" ? (
          <SignIn connection={state.connection} notice={state.notice} t={t} />
        ) : native === "attendance" && canAttendance && sync.firstSyncDone ? (
          <Attendance sync={sync} offline={offline} locale={locale} t={t} />
        ) : native ? (
          <Home offline={offline} lastContact={state.lastContact} sync={sync} canAttendance={canAttendance} locale={locale} t={t} />
        ) : offline ? (
          // Online only (the platform admin): nothing works without the internet.
          <OnlineOnlyOffline t={t} />
        ) : !state.webShown ? (
          <Opening label={t("loading")} />
        ) : null}
      </main>
    </div>
  );
}

function Opening({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <img src={mark} alt="" className="size-14 animate-pulse" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function OnlineOnlyOffline({ t }: { t: ReturnType<typeof translator> }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{t("offlineTitle")}</h1>
      <p className="max-w-md text-sm text-muted">{t("onlineOnlyOffline")}</p>
      <button type="button" onClick={() => void window.ilmways.retryConnection()} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-110">
        {t("tryAgain")}
      </button>
    </div>
  );
}
