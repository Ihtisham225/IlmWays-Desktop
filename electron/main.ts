import { app, BrowserWindow, ipcMain, Menu, powerMonitor, session as electronSession, shell, WebContentsView } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { BAR_HEIGHT, type AppState, type Connection, type LoginResult, type SignedOutNotice, type UpdateState } from "../shared/types";
import { contactExpired, linkTarget, serverUrl, signInPageMeaning } from "../shared/rules";
import { clearSession, loadSession, saveSession } from "./store";
import { createServer } from "./server";

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "../dist");
const PUBLIC = app.isPackaged ? DIST : path.join(__dirname, "../public");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Development only: lets tooling inspect the windows. Never in an installed build.
if (!app.isPackaged && process.env.ILMWAYS_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.ILMWAYS_DEBUG_PORT);
}

const SERVER = serverUrl(process.env);
const server = createServer(SERVER);
/** The web app's own cookie jar, kept apart from the window's. */
const WEB_PARTITION = "persist:ilmways-web";
const CHECK_EVERY_MS = 30_000;

let win: BrowserWindow | null = null;
let web: WebContentsView | null = null;
let state: AppState = { phase: "starting" };

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function setState(next: AppState) {
  const wasOffline = state.phase === "signed-in" && state.connection === "offline";
  state = next;
  win?.webContents.send("state", state);
  layoutWeb();
  // Back online with the web app open: pages that failed while offline load again.
  if (wasOffline && state.phase === "signed-in" && state.connection === "online" && state.webShown) {
    web?.webContents.reload();
  }
}

function setConnection(connection: Connection) {
  if (state.phase === "signed-in" || state.phase === "signed-out") {
    if (state.connection !== connection) setState({ ...state, connection });
  }
}

/* ------------------------------------------------------------------ */
/* The web app, under the bar                                          */
/* ------------------------------------------------------------------ */

function layoutWeb() {
  if (!win || !web) return;
  const show = state.phase === "signed-in" && state.webShown && state.connection !== "offline";
  web.setVisible(show);
  const [width, height] = win.getContentSize();
  web.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) });
}

function ensureWeb(): WebContentsView {
  if (web) return web;
  web = new WebContentsView({
    webPreferences: {
      partition: WEB_PARTITION,
      // The web app gets nothing from Electron: no preload, no Node, sandboxed.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win!.contentView.addChildView(web);
  const contents = web.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    const where = linkTarget(url, SERVER);
    if (where === "browser") void shell.openExternal(url);
    if (where === "window") void contents.loadURL(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const where = linkTarget(url, SERVER);
    if (where === "window") return;
    event.preventDefault();
    if (where === "browser") void shell.openExternal(url);
  });
  contents.on("did-navigate", (_event, url) => void onWebNavigated(url));
  // The web app moves between pages without reloading (Next.js), and its
  // sign-out ends with one of those moves, so in-page navigations count too.
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) void onWebNavigated(url);
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    // -3 is an aborted load (a redirect, a new navigation): not a network problem.
    if (isMainFrame && code !== -3) void check();
  });
  layoutWeb();
  return web;
}

let claimRetried = false;

async function onWebNavigated(url: string) {
  const meaning = signInPageMeaning(url, SERVER);
  if (meaning === "not-sign-in") {
    claimRetried = false;
    return;
  }
  if (meaning === "claim-failed" && !claimRetried) {
    claimRetried = true;
    await claimWeb();
    return;
  }
  // Signing out inside the web app signs this PC out: the desktop is the identity.
  await signOut(meaning === "signed-out" ? "signed-out-on-web" : "expired");
}

/** Sign the web view in with a fresh one-minute code and show it. */
async function claimWeb() {
  const stored = loadSession();
  if (!stored || state.phase !== "signed-in") return;
  const reply = await server.webSession(stored.token);
  if (reply.kind === "offline") return setConnection("offline");
  if (reply.kind === "refused") {
    if (reply.status === 401) await signOut("revoked");
    return;
  }
  await ensureWeb().webContents.loadURL(`${SERVER}${reply.data.url}`);
  if (state.phase === "signed-in") setState({ ...state, webShown: true });
}

/* ------------------------------------------------------------------ */
/* Signing in and out                                                  */
/* ------------------------------------------------------------------ */

async function login(identifier: string, password: string): Promise<LoginResult> {
  const reply = await server.login(identifier, password);
  if (reply.kind === "offline") return { ok: false, message: "Can't reach IlmWays. Check the internet connection and try again." };
  if (reply.kind === "refused") return { ok: false, message: reply.message };

  const token = reply.data.token;
  const described = await server.session(token);
  if (described.kind !== "ok") return { ok: false, message: "Signed in, but the school's details didn't load. Please try again." };

  const lastContact = new Date().toISOString();
  saveSession({ token, session: described.data, lastContact });
  setState({ phase: "signed-in", connection: "online", session: described.data, lastContact, webShown: false });
  await claimWeb();
  return { ok: true };
}

async function signOut(notice?: SignedOutNotice) {
  const stored = loadSession();
  clearSession();
  // Best effort: an offline PC still signs itself out; the token then lapses on its own.
  if (stored) void server.logout(stored.token);
  await electronSession.fromPartition(WEB_PARTITION).clearStorageData();
  if (web) {
    win?.contentView.removeChildView(web);
    web.webContents.close();
    web = null;
  }
  setState({ phase: "signed-out", connection: state.phase === "starting" ? "checking" : connectionOf(state), notice });
}

const connectionOf = (s: AppState): Connection => (s.phase === "starting" ? "checking" : s.connection);

/* ------------------------------------------------------------------ */
/* Staying in touch                                                    */
/* ------------------------------------------------------------------ */

let checking: Promise<void> | null = null;

/**
 * One call answers both "is the server reachable" and "is this PC still
 * signed in". Runs every 30 s, when the window is focused and after sleep.
 */
function check(): Promise<void> {
  checking ??= doCheck().finally(() => (checking = null));
  return checking;
}

async function doCheck() {
  const stored = loadSession();
  if (!stored) {
    // Signed out: only reachability matters (for the sign-in screen's message).
    const probe = await server.session("");
    if (state.phase === "starting") setState({ phase: "signed-out", connection: probe.kind === "offline" ? "offline" : "online" });
    else setConnection(probe.kind === "offline" ? "offline" : "online");
    return;
  }

  const reply = await server.session(stored.token);
  if (reply.kind === "ok") {
    const lastContact = new Date().toISOString();
    saveSession({ ...stored, session: reply.data, lastContact });
    const webShown = state.phase === "signed-in" ? state.webShown : false;
    setState({ phase: "signed-in", connection: "online", session: reply.data, lastContact, webShown });
    if (!webShown) await claimWeb();
    return;
  }
  if (reply.kind === "refused" && reply.status === 401) {
    await signOut("revoked");
    return;
  }
  // Offline (or the server erring): keep working from what the PC already knows.
  if (contactExpired(stored.lastContact)) {
    await signOut("expired");
    return;
  }
  setState({
    phase: "signed-in",
    connection: reply.kind === "offline" ? "offline" : "online",
    session: stored.session,
    lastContact: stored.lastContact,
    webShown: state.phase === "signed-in" ? state.webShown : false,
  });
}

/* ------------------------------------------------------------------ */
/* Updates (as UC-Ultra-Desktop: the state is kept so a late window sees it) */
/* ------------------------------------------------------------------ */

let updateState: UpdateState = { status: "idle" };
function setUpdateState(next: UpdateState) {
  updateState = next;
  win?.webContents.send("update-state", next);
}
autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking" }));
autoUpdater.on("update-available", (info) => setUpdateState({ status: "available", version: info.version, percent: 0 }));
autoUpdater.on("download-progress", (p) => setUpdateState({ status: "available", version: updateState.version, percent: Math.round(p.percent) }));
autoUpdater.on("update-not-available", () => setUpdateState({ status: "none" }));
autoUpdater.on("update-downloaded", (info) => setUpdateState({ status: "downloaded", version: info.version }));
// Without this the updater fails silently and looks exactly like "no update".
autoUpdater.on("error", (error) => {
  console.error("[updater]", error);
  setUpdateState({ status: "error", message: error?.message ?? String(error) });
});

/* ------------------------------------------------------------------ */
/* Window and IPC                                                      */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(PUBLIC, "icon.png"),
    title: "IlmWays",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("resize", layoutWeb);
  win.on("focus", () => void check());
  win.on("closed", () => {
    win = null;
    web = null;
  });
  // The window's own page never navigates away or opens windows.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(DIST, "index.html"));
}

ipcMain.handle("state:get", () => state);
ipcMain.handle("auth:login", (_event, identifier: unknown, password: unknown) =>
  typeof identifier === "string" && typeof password === "string" ? login(identifier.slice(0, 200), password.slice(0, 200)) : { ok: false, message: "Enter your login ID and password." },
);
ipcMain.handle("auth:logout", () => signOut());
ipcMain.handle("connection:retry", () => check());
ipcMain.handle("update:get", () => updateState);
ipcMain.on("update:install", () => autoUpdater.quitAndInstall());
ipcMain.handle("app:version", () => app.getVersion());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : [{ label: "File", submenu: [{ role: "quit" as const }] }]),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    createWindow();

    // Signed in before? Show it at once from what the PC remembers, then check.
    const stored = loadSession();
    if (stored && !contactExpired(stored.lastContact)) {
      setState({ phase: "signed-in", connection: "checking", session: stored.session, lastContact: stored.lastContact, webShown: false });
    }
    await check();
    setInterval(() => void check(), CHECK_EVERY_MS);
    powerMonitor.on("resume", () => void check());

    if (app.isPackaged) {
      void autoUpdater.checkForUpdatesAndNotify();
      setInterval(() => void autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 60 * 60_000);
    }
  });
}
