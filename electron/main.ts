import { app, BrowserWindow, ipcMain, Menu, nativeTheme, powerMonitor, session as electronSession, shell, WebContentsView } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import {
  BAR_HEIGHT,
  type AppState,
  type Connection,
  type LoginResult,
  type NativeScreen,
  type ReceiptSize,
  type SaveResult,
  type SessionInfo,
  type SignedOutNotice,
  type UpdateState,
  type WebNav,
} from "../shared/types";
import { contactExpired, linkTarget, serverUrl, signInPageMeaning } from "../shared/rules";
import { isDay, localDay, registerBlock } from "../shared/register";
import { clearSession, loadSession, saveSession } from "./store";
import { createServer } from "./server";
import { closeOffline, currentOffline, offlineFor } from "./offline";
import { createSync } from "./sync";
import { addReceiptBlock, collect, feeSetup, ledger, receipt, receiptsLeft, saveSchool, searchStudents } from "./fees";
import { RECEIPT_TOP_UP } from "../shared/fees";

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "../dist");
const PUBLIC = app.isPackaged ? DIST : path.join(__dirname, "../public");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// A development copy keeps its own folder, apart from the installed app's:
// they share the app's name, and a developer signing in against a local
// server must never replace the sign-in of the IlmWays installed on the same
// Mac (it did once, and the installed app then signed itself out).
// Before anything reads userData, the single-instance lock included.
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), `${app.getName()}-dev`));
}

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
/** One of the window's own screens drawn over the web app, or null for the web app. */
let screen: NativeScreen | null = null;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function setState(next: AppState) {
  const wasOffline = state.phase === "signed-in" && state.connection === "offline";
  state = next;
  // The offline copy belongs to the signed-in school and user; none for the platform admin.
  if (state.phase === "signed-in") offlineFor(state.session);
  sendSyncStatus();
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
  const show = state.phase === "signed-in" && state.webShown && state.connection !== "offline" && screen === null;
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
  contents.on("did-navigate", (_event, url) => {
    sendWebNav();
    void onWebNavigated(url);
  });
  contents.on("page-title-updated", sendWebNav);
  // The web app moves between pages without reloading (Next.js), and its
  // sign-out ends with one of those moves, so in-page navigations count too.
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    sendWebNav();
    void onWebNavigated(url);
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
  if (meaning === "claim-failed" || meaning === "lapsed") {
    if (!claimRetried) {
      claimRetried = true;
      await claimWeb();
      return;
    }
    // Twice in a row: the server is having trouble (a deploy, say). That is
    // no reason to sign the PC out. The next check (within 30 s) tries again,
    // and signs out only if the server refuses the PC's own token.
    if (state.phase === "signed-in") setState({ ...state, webShown: false });
    return;
  }
  // Signing out inside the web app signs this PC out: the desktop is the identity.
  await signOut(meaning === "signed-out" ? "signed-out-on-web" : "expired");
}

/** Sign the web view in with a fresh one-minute code and show it. */
async function claimWeb() {
  const stored = loadSession(SERVER);
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
  saveSession({ server: SERVER, token, session: described.data, lastContact });
  setState({ phase: "signed-in", connection: "online", session: described.data, lastContact, webShown: false });
  void sync.run();
  await claimWeb();
  return { ok: true };
}

async function signOut(notice?: SignedOutNotice) {
  const stored = loadSession(SERVER);
  clearSession();
  // Deleted with its key, unless changes made here haven't reached the server yet (D4).
  await sync.idle();
  closeOffline({ forget: true });
  setScreen(null);
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
  const stored = loadSession(SERVER);
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
    void sync.run();
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
/* Offline work: the copy on this PC and keeping it in sync            */
/* ------------------------------------------------------------------ */

const signedInSession = (): SessionInfo | null => (state.phase === "signed-in" ? state.session : null);

const sync = createSync({
  db: () => {
    const session = signedInSession();
    return session && !session.onlineOnly ? currentOffline() : null;
  },
  server,
  token: () => loadSession(SERVER)?.token ?? null,
  tables: () => signedInSession()?.syncTables ?? [],
  changed: () => sendSyncStatus(),
  unauthorized: () => void signOut("revoked"),
  offline: () => setConnection("offline"),
  online: () => {
    // The sync reached the server; the regular check claims the web view if it isn't yet.
    if (state.phase === "signed-in" && state.connection === "offline") void check();
  },
  between: async (db, token) => {
    const session = signedInSession();
    if (!session) return;
    const fees = feePermissionsOf(session);
    if (fees.canView && Date.now() - Number(db.getMeta("schoolFetched") ?? 0) > 60 * 60_000) {
      const reply = await server.school(token);
      if (reply.kind === "ok" && reply.data.school) {
        saveSchool(db, reply.data.school);
        db.setMeta("schoolFetched", String(Date.now()));
      }
    }
    // Receipt numbers to hand out offline (D2): ask for more before they run out.
    if (fees.canCollect && receiptsLeft(db) < RECEIPT_TOP_UP) {
      const reply = await server.reserveNumbers(token, "receipt");
      if (reply.kind === "ok") addReceiptBlock(db, reply.data.block);
    }
  },
});

function sendSyncStatus() {
  win?.webContents.send("sync-status", sync.status());
}

function setScreen(next: NativeScreen | null) {
  screen = next;
  win?.webContents.send("screen", screen);
  layoutWeb();
}

function sendWebNav() {
  const contents = web?.webContents;
  if (!contents || !win) return;
  const nav: WebNav = {
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    title: contents.getTitle(),
  };
  win.webContents.send("web-nav", nav);
}

const feePermissionsOf = (session: SessionInfo) => ({
  canView: session.permissions.includes("fee.view") || session.permissions.includes("fee.collect"),
  canCollect: session.permissions.includes("fee.collect"),
});

/** The offline copy, when the signed-in account keeps one. */
const offlineDb = () => (sync.status().available ? currentOffline() : null);

function collectFee(input: unknown) {
  const session = signedInSession();
  const db = offlineDb();
  if (!session || !db || !feePermissionsOf(session).canCollect) return { ok: false as const, message: "unavailable" };
  const raw = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const result = collect(
    db,
    {
      studentId: str(raw.studentId) ?? "",
      amount: typeof raw.amount === "number" ? raw.amount : NaN,
      accountId: str(raw.accountId),
      reference: str(raw.reference),
      paidOn: str(raw.paidOn) ?? "",
    },
    localDay(),
  );
  if (!result.ok) return result;
  sendSyncStatus();
  // One write path (D8): saved here first, sent at once when online.
  void sync.run();
  return { ok: true as const, receiptKey: result.receiptKey };
}

/**
 * Print a page the window drew, in a hidden window of its own: no scripts,
 * no navigation, nothing but the page. A4, or an 80 mm thermal roll.
 */
async function printHtml(html: unknown, size: ReceiptSize): Promise<SaveResult> {
  if (typeof html !== "string" || html.length > 5_000_000) return { ok: false, message: "unavailable" };
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  page.webContents.on("will-navigate", (event) => event.preventDefault());
  page.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise<SaveResult>((resolve) =>
      page.webContents.print(
        {
          silent: false,
          printBackground: true,
          margins: { marginType: size === "thermal" ? "none" : "default" },
          pageSize: size === "thermal" ? { width: 80_000, height: 297_000 } : "A4",
        },
        (ok, reason) => resolve(ok || reason === "cancelled" ? { ok: true } : { ok: false, message: reason }),
      ),
    );
  } finally {
    page.destroy();
  }
}

const permissionsOf = (session: SessionInfo) => ({
  canView: session.permissions.includes("attendance.view") || session.permissions.includes("attendance.mark"),
  canMark: session.permissions.includes("attendance.mark"),
  canEdit: session.permissions.includes("attendance.edit"),
});

function attendanceSetup() {
  const session = signedInSession();
  const db = sync.status().available ? currentOffline() : null;
  const today = localDay();
  if (!session || !db) return { session: null, sections: [], statuses: [], today, canView: false, canMark: false, canEdit: false };
  return db.attendanceSetup(permissionsOf(session), today);
}

function attendanceRegister(sectionId: unknown, date: unknown) {
  const db = sync.status().available ? currentOffline() : null;
  if (!db || typeof sectionId !== "string" || !isDay(date)) return { sectionId: String(sectionId), date: String(date), entries: [], waiting: false, issue: null };
  return db.register(sectionId, date);
}

function saveRegister(input: unknown): SaveResult {
  const session = signedInSession();
  const db = sync.status().available ? currentOffline() : null;
  if (!session || !db) return { ok: false, message: "unavailable" };
  const { sectionId, date, entries } = (input ?? {}) as { sectionId?: unknown; date?: unknown; entries?: unknown };
  if (typeof sectionId !== "string" || !isDay(date) || !Array.isArray(entries)) return { ok: false, message: "stale" };

  const today = localDay();
  const blocked = registerBlock(date, today, permissionsOf(session));
  if (blocked) return { ok: false, message: blocked };

  const marks = entries
    .filter((e): e is { enrollmentId: string; statusId: string } => typeof e?.enrollmentId === "string" && typeof e?.statusId === "string")
    .map((e) => ({ enrollmentId: e.enrollmentId, statusId: e.statusId }));
  const saved = db.saveRegister({ sectionId, date, savedOn: today, entries: marks });
  if (!saved.ok) return saved;
  sendSyncStatus();
  // One write path (D8): saved here first, sent at once when online.
  void sync.run();
  return { ok: true };
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

/** The bar's colours, in step with src/index.css, so Windows' drawn buttons match it. */
function barColors() {
  return nativeTheme.shouldUseDarkColors
    ? { background: "#1f1f1e", symbols: "#d4d4d2" }
    : { background: "#f4f4f2", symbols: "#3a3a38" };
}

function titleBarOverlay() {
  const colors = barColors();
  return { color: colors.background, symbolColor: colors.symbols, height: BAR_HEIGHT };
}

nativeTheme.on("updated", () => {
  if (win && process.platform !== "darwin") win.setTitleBarOverlay(titleBarOverlay());
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(PUBLIC, "icon.png"),
    title: "IlmWays",
    show: false,
    // The app's own bar is the title bar, as in Claude and UC Ultra: the
    // window buttons sit in it (macOS on the left; Windows' drawn over its right end).
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: Math.round((BAR_HEIGHT - 16) / 2) },
    ...(process.platform === "darwin" ? {} : { titleBarOverlay: titleBarOverlay() }),
    backgroundColor: barColors().background,
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

ipcMain.on("screen:set", (_event, next: unknown) => setScreen(next === "home" || next === "attendance" || next === "fees" ? next : null));
ipcMain.on("web:back", () => web?.webContents.navigationHistory.goBack());
ipcMain.on("web:forward", () => web?.webContents.navigationHistory.goForward());
ipcMain.on("web:reload", () => web?.webContents.reload());
ipcMain.on("menu:account", (_event, at: unknown, labels: unknown) => {
  const session = signedInSession();
  if (!win || !session) return;
  const point = (at ?? {}) as { x?: unknown; y?: unknown };
  const words = (labels ?? {}) as { signOut?: unknown; waiting?: unknown; version?: unknown };
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : "");
  Menu.buildFromTemplate([
    { label: session.user.name, enabled: false },
    { label: session.user.loginId, enabled: false },
    { type: "separator" },
    ...(text(words.waiting) ? [{ label: text(words.waiting), enabled: false }, { type: "separator" as const }] : []),
    { label: text(words.version) || `IlmWays ${app.getVersion()}`, enabled: false },
    { label: text(words.signOut) || "Sign out", click: () => void signOut() },
  ]).popup({ window: win, x: Math.round(Number(point.x) || 0), y: Math.round(Number(point.y) || 0) });
});

ipcMain.handle("sync:status", () => sync.status());
ipcMain.handle("sync:now", () => sync.run());
ipcMain.handle("sync:retry", (_event, opId: unknown) => {
  if (typeof opId === "string") currentOffline()?.retryOp(opId);
  sendSyncStatus();
  return sync.run();
});
ipcMain.handle("sync:discard", (_event, opId: unknown) => {
  if (typeof opId === "string") currentOffline()?.discardOp(opId);
  sendSyncStatus();
});
ipcMain.handle("attendance:setup", () => attendanceSetup());
ipcMain.handle("attendance:register", (_event, sectionId: unknown, date: unknown) => attendanceRegister(sectionId, date));
ipcMain.handle("attendance:save", (_event, input: unknown) => saveRegister(input));
ipcMain.handle("fees:setup", () => {
  const session = signedInSession();
  const db = offlineDb();
  return session && db ? feeSetup(db, feePermissionsOf(session), localDay()) : null;
});
ipcMain.handle("fees:search", (_event, query: unknown) => {
  const db = offlineDb();
  return db && typeof query === "string" ? searchStudents(db, query.slice(0, 80)) : [];
});
ipcMain.handle("fees:ledger", (_event, studentId: unknown) => {
  const db = offlineDb();
  return db && typeof studentId === "string" ? ledger(db, studentId) : null;
});
ipcMain.handle("fees:collect", (_event, input: unknown) => collectFee(input));
ipcMain.handle("fees:receipt", (_event, key: unknown) => {
  const db = offlineDb();
  return db && typeof key === "string" ? receipt(db, key) : null;
});
ipcMain.handle("print:html", (_event, html: unknown, size: unknown) => printHtml(html, size === "thermal" ? "thermal" : "a4"));

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
    const stored = loadSession(SERVER);
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
