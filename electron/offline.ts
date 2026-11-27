import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { SessionInfo } from "../shared/types";
import { LocalDb } from "./localdb";

/**
 * Where the offline copy lives (D3): one encrypted file per school and user,
 * with its own random key, itself encrypted by the operating system's
 * keychain (`safeStorage`) and kept beside it. Without the keychain the
 * copy is kept in memory only, for as long as the app is open: never on
 * disk in the clear.
 *
 * The platform admin gets no file at all (D1).
 */

const dir = () => path.join(app.getPath("userData"), "offline");
const base = (session: SessionInfo) => path.join(dir(), `${session.school!.id}-${session.user.id}`);

let open: { db: LocalDb; owner: string } | null = null;

/** The copy for this session, opened (or made) if it isn't already. Null for an online-only account. */
export function offlineFor(session: SessionInfo): LocalDb | null {
  if (session.onlineOnly || !session.school) {
    closeOffline();
    return null;
  }
  const owner = base(session);
  if (open?.owner === owner) return open.db;
  closeOffline();

  if (!safeStorage.isEncryptionAvailable()) {
    open = { db: new LocalDb(":memory:"), owner };
    return open.db;
  }

  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const file = `${owner}.db`;
  const keyFile = `${owner}.key`;
  let key: string | null = null;
  try {
    key = safeStorage.decryptString(fs.readFileSync(keyFile));
  } catch {
    key = null;
  }
  if (key) {
    try {
      open = { db: new LocalDb(file, key), owner };
      return open.db;
    } catch (error) {
      // A key that no longer opens its file (the keychain was reset): the copy is lost, and downloads again.
      console.error("[offline] could not open the offline copy; starting afresh", error);
    }
  }
  removeFiles(owner);
  key = randomBytes(32).toString("hex");
  fs.writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 });
  open = { db: new LocalDb(file, key), owner };
  return open.db;
}

export const currentOffline = () => open?.db ?? null;

/**
 * Signing out. The copy and its key are deleted, unless changes made here
 * haven't reached the server yet: those are kept until the same person
 * signs in again on this PC (D4), and sent then.
 */
export function closeOffline(options: { forget?: boolean } = {}) {
  if (!open) return;
  const { db, owner } = open;
  const keep = db.outboxCount() > 0;
  db.close();
  open = null;
  if (options.forget && !keep) removeFiles(owner);
}

function removeFiles(owner: string) {
  for (const suffix of [".db", ".db-wal", ".db-shm", ".key"]) fs.rmSync(`${owner}${suffix}`, { force: true });
}
