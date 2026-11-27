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
  platform: NodeJS.Platform;
  locale: string;
};

/** Height of the window's own top bar; the web view sits below it. */
export const BAR_HEIGHT = 44;
