import { app } from "electron";
import os from "node:os";
import type { SchoolInfo, SessionInfo } from "../shared/types";
import type { SyncServer } from "./sync";

/**
 * The IlmWays server's desktop API (/api/desktop/v1 in the ilmways repo).
 * Every answer is `{ data }` or `{ error: { message, code } }`. A network
 * failure is reported as `offline`, never thrown, so the app can tell "the
 * server said no" from "the server can't be reached".
 */
export type Reply<T> = { kind: "ok"; data: T } | { kind: "refused"; status: number; code: string; message: string } | { kind: "offline" };

const TIMEOUT_MS = 10_000;
/** A page of a large school's first download can take a while from Pakistan to the US. */
const SYNC_TIMEOUT_MS = 60_000;

export function createServer(base: string) {
  async function call<T>(method: "GET" | "POST", path: string, options: { token?: string; body?: unknown; timeout?: number } = {}): Promise<Reply<T>> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          "user-agent": `IlmWays-Desktop/${app.getVersion()} (${process.platform})`,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeout ?? TIMEOUT_MS),
      });
    } catch {
      return { kind: "offline" };
    }
    let payload: { data?: T; error?: { message?: string; code?: string } } = {};
    try {
      payload = await response.json();
    } catch {
      // A captive portal or a proxy's error page: not our server answering.
      return { kind: "offline" };
    }
    if (response.ok && payload.data !== undefined) return { kind: "ok", data: payload.data };
    return {
      kind: "refused",
      status: response.status,
      code: payload.error?.code ?? "UNKNOWN",
      message: payload.error?.message ?? "Something went wrong. Please try again.",
    };
  }

  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";

  return {
    base,
    login: (identifier: string, password: string) =>
      call<{ token: string; mustChangePassword: boolean; onlineOnly: boolean }>("POST", "/api/desktop/v1/auth/login", {
        body: { identifier, password, device: { name: os.hostname().slice(0, 120), platform, appVersion: app.getVersion() } },
      }),
    session: (token: string) => call<SessionInfo>("GET", "/api/desktop/v1/session", { token }),
    logout: (token: string) => call<{ signedOut: boolean }>("POST", "/api/desktop/v1/auth/logout", { token }),
    webSession: (token: string) => call<{ url: string }>("POST", "/api/desktop/v1/web-session", { token }),
    reserveNumbers: (token: string, kind: "receipt") =>
      call<{ block: { id: string; kind: string; prefix: string; first: number; last: number } }>("POST", "/api/desktop/v1/number-blocks", { token, body: { kind } }),
    school: (token: string) => call<{ school: SchoolInfo }>("GET", "/api/desktop/v1/school", { token }),
    pull: ((token, body) => call("POST", "/api/desktop/v1/sync/pull", { token, body, timeout: SYNC_TIMEOUT_MS })) as SyncServer["pull"],
    push: ((token, ops) => call("POST", "/api/desktop/v1/sync/push", { token, body: { ops }, timeout: SYNC_TIMEOUT_MS })) as SyncServer["push"],
  };
}

export type Server = ReturnType<typeof createServer>;
