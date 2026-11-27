import { useEffect, useState } from "react";
import type { AppState, UpdateState } from "../shared/types";
import { translator, type Locale } from "./i18n";
import { TopBar } from "./TopBar";
import { SignIn } from "./screens/SignIn";
import { Offline } from "./screens/Offline";
import mark from "./lib/mark.svg";

/**
 * The window's own page. It never holds the device token or talks to the
 * server: the main process does that and tells this page the state. While
 * signed in and online, the web app is drawn by the main process under the
 * bar, and this page shows only the bar.
 */
export function App({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, setState] = useState<AppState>({ phase: "starting" });
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    const api = window.ilmways;
    void api.getState().then(setState);
    void api.getUpdateState().then(setUpdate);
    const offState = api.onState(setState);
    const offUpdate = api.onUpdateState(setUpdate);
    return () => {
      offState();
      offUpdate();
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar state={state} update={update} t={t} />
      <main className="min-h-0 flex-1 overflow-auto">
        {state.phase === "starting" ? (
          <Centered>
            <img src={mark} alt="" className="size-14 animate-pulse" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </Centered>
        ) : state.phase === "signed-out" ? (
          <SignIn connection={state.connection} notice={state.notice} t={t} />
        ) : state.connection === "offline" ? (
          <Offline lastContact={state.lastContact} locale={locale} t={t} />
        ) : !state.webShown ? (
          <Centered>
            <img src={mark} alt="" className="size-14 animate-pulse" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </Centered>
        ) : null}
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">{children}</div>;
}
