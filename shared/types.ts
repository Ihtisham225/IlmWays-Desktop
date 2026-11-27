/**
 * What the main process tells the window. The main process owns the device
 * token and every call to the server; the window only ever sees this.
 */

export type SessionInfo = {
  user: { id: string; name: string; loginId: string; avatar: string | null; mustChangePassword: boolean };
  school: { id: string; name: string; logo: string | null } | null;
  /** The platform admin: the web inside the app, never any school's data offline. */
  onlineOnly: boolean;
  permissions: string[];
  syncTables: string[];
};

export type Connection = "checking" | "online" | "offline";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloaded" | "none" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

export type AppState =
  | { phase: "starting" }
  | { phase: "signed-out"; connection: Connection; notice?: SignedOutNotice }
  | {
      phase: "signed-in";
      connection: Connection;
      session: SessionInfo;
      /** When the server was last reached; offline screens show it. */
      lastContact: string;
      /** The web app is loaded and showing under the bar. */
      webShown: boolean;
    };

/** Why the sign-in screen is showing, when it isn't a fresh start. */
export type SignedOutNotice = "revoked" | "expired" | "signed-out-on-web";

export type LoginResult = { ok: true } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* Offline work (Phase 3: attendance)                                  */
/* ------------------------------------------------------------------ */

/** A change that the server would not take, waiting for someone to look at it. */
export type SyncIssue = {
  opId: string;
  /** What it was, in the app's words: "Attendance — Class 5 — A, 2026-11-27". */
  title: string;
  message: string;
  createdAt: string;
};

/** Where this PC's offline copy stands. The bar and every offline screen show it. */
export type SyncStatus = {
  /** False for the platform admin and when signed out: nothing is kept on the PC. */
  available: boolean;
  /** A sync is under way right now. */
  running: boolean;
  /** The first download hasn't finished; offline screens can't work yet. */
  firstSyncDone: boolean;
  /** Rows downloaded in the sync under way, for the progress line. */
  downloaded: number;
  /** Saved on this PC and not yet on the server. */
  waiting: number;
  issues: SyncIssue[];
  /** When the last full sync (send, then download) finished. */
  lastSynced: string | null;
  /** Why the last sync stopped short, when the server refused it (not when offline). */
  error: string | null;
};

export type AttendanceStatusOption = { id: string; code: string; label: string; labelUr: string | null; effect: string };

export type AttendanceSetup = {
  session: { id: string; name: string } | null;
  sections: { id: string; label: string }[];
  statuses: AttendanceStatusOption[];
  /** The PC's own date, which is the school's day for a register marked here. */
  today: string;
  canView: boolean;
  canMark: boolean;
  /** May change an earlier day's register. */
  canEdit: boolean;
};

export type RegisterEntry = {
  enrollmentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  statusId: string | null;
};

export type Register = {
  sectionId: string;
  date: string;
  entries: RegisterEntry[];
  /** Saved on this PC and not yet on the server. */
  waiting: boolean;
  /** The server refused the last save of this register; see the sync issues. */
  issue: string | null;
};

export type SaveResult = { ok: true } | { ok: false; message: string };

/** The window's own screens over the web app. */
export type NativeScreen = "home" | "attendance";

export type DesktopApi = {
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  login(identifier: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  retryConnection(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  installUpdate(): void;
  appVersion(): Promise<string>;

  /** Show one of the window's own screens over the web app, or null for the web app. */
  setScreen(screen: NativeScreen | null): void;
  onScreen(listener: (screen: NativeScreen | null) => void): () => void;
  /** The web app's history, for the bar's back and forward buttons. */
  onWebNav(listener: (nav: WebNav) => void): () => void;
  webBack(): void;
  webForward(): void;
  webReload(): void;
  /** The account menu, drawn natively so it shows over the web app. `at` is in window coordinates. */
  openAccountMenu(at: { x: number; y: number }, labels: { signOut: string; version: string; waiting?: string }): void;

  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  syncNow(): Promise<void>;
  retryIssue(opId: string): Promise<void>;
  discardIssue(opId: string): Promise<void>;

  attendanceSetup(): Promise<AttendanceSetup>;
  attendanceRegister(sectionId: string, date: string): Promise<Register>;
  saveRegister(input: { sectionId: string; date: string; entries: { enrollmentId: string; statusId: string }[] }): Promise<SaveResult>;
  platform: NodeJS.Platform;
  locale: string;
};

export type WebNav = { canGoBack: boolean; canGoForward: boolean; title: string };

/** Height of the window's own title bar; the web view sits below it. */
export const BAR_HEIGHT = 40;
