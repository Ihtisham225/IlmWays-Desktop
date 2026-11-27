import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SessionInfo } from "../shared/types";

/**
 * What the PC remembers between launches: the device token, encrypted by the
 * operating system's keychain (`safeStorage`), the last session the server
 * described, and when the server was last reached. No password is ever kept.
 *
 * If the OS offers no encryption (some Linux desktops without a keyring),
 * nothing is written: the PC then signs in on every launch, which is better
 * than a token lying on disk in the clear.
 */
type Stored = { server: string; token: string; session: SessionInfo; lastContact: string };
/** `server` is missing from files written by v0.1, which only ever talked to production. */
type OnDisk = { server?: string; tokenEncrypted: string; session: SessionInfo; lastContact: string };

const PRODUCTION = "https://www.ilmways.com";

const file = () => path.join(app.getPath("userData"), "device-session.json");

let memory: Stored | null = null;

/**
 * The sign-in saved for `server`. One saved for another server (a developer
 * pointing the app elsewhere) is ignored, never used: that server's token
 * would be refused here, and a refusal signs the PC out.
 */
export function loadSession(server: string): Stored | null {
  if (memory) return memory.server === server ? memory : null;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as OnDisk;
    if ((raw.server ?? PRODUCTION) !== server) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const token = safeStorage.decryptString(Buffer.from(raw.tokenEncrypted, "base64"));
    memory = { server, token, session: raw.session, lastContact: raw.lastContact };
    return memory;
  } catch {
    return null;
  }
}

export function saveSession(next: Stored) {
  memory = next;
  if (!safeStorage.isEncryptionAvailable()) return;
  const onDisk: OnDisk = {
    server: next.server,
    tokenEncrypted: safeStorage.encryptString(next.token).toString("base64"),
    session: next.session,
    lastContact: next.lastContact,
  };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(onDisk), { mode: 0o600 });
}

export function clearSession() {
  memory = null;
  try {
    fs.unlinkSync(file());
  } catch {
    /* already gone */
  }
}
