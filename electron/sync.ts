import type { SyncStatus } from "../shared/types";
import { isLocalTable, LOCAL_TABLES, TOMBSTONES, type LocalDb, type LocalTable, type OutboxOp } from "./localdb";
import type { Reply } from "./server";

/**
 * The sync engine (docs/DESKTOP-PLAN.md §3): send what is waiting, then
 * download what changed. One run at a time; a run asked for while one is
 * going happens straight after it, so a save made mid-sync is still sent.
 *
 * No Electron here: main.ts supplies the database, the server and the
 * signed-in user, and the tests use fakes.
 */

type Row = Record<string, unknown>;
type PullPage = { rows: Row[]; cursor: unknown; serverTime: string };
type TombstonePage = { deleted: { table: string; id: string }[]; cursor: unknown; serverTime: string; reset: boolean };
type PushResult = { opId: string; status: "applied" | "duplicate" | "conflict" | "parent-missing" | "error"; message?: string; result?: unknown };

export type SyncServer = {
  pull(
    token: string,
    body: { tables: { table: string; since: string | null; cursor: unknown; limit: number }[]; tombstones?: { since: string | null; cursor: unknown; limit: number } },
  ): Promise<Reply<{ tables: Record<string, PullPage>; tombstones: TombstonePage | null }>>;
  push(token: string, ops: OutboxOp[]): Promise<Reply<{ results: PushResult[] }>>;
};

export type SyncDeps = {
  db(): LocalDb | null;
  server: SyncServer;
  token(): string | null;
  /** The tables the server lets this user keep (the session's `syncTables`), parents first. */
  tables(): string[];
  /** Something changed that the window should see. */
  changed(): void;
  /** The server no longer knows this PC's token. */
  unauthorized(): void;
  /** The server couldn't be reached. */
  offline(): void;
  /** The server could be reached (it answered, even with a refusal). */
  online(): void;
  /**
   * Between sending and downloading, while the server answers: keep what a
   * workflow needs on hand (receipt numbers, the school's details).
   */
  between?(db: LocalDb, token: string): Promise<void>;
};

export const PAGE = 2000;
const PUSH_BATCH = 200;
/** The server's answer while another push of the same change is still running: not a refusal, just try later. */
const BUSY = /already being saved/i;

export function createSync(deps: SyncDeps) {
  let running: Promise<void> | null = null;
  let again = false;
  let downloaded = 0;
  let error: string | null = null;

  /** The tables to keep: what the server allows, of those this app version knows. */
  const tables = () => deps.tables().filter(isLocalTable);

  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await once();
      } while (again);
    })().finally(() => {
      running = null;
      downloaded = 0;
      deps.changed();
    });
    deps.changed();
    return running;
  }

  /** false: stop this run (offline, signed out, or refused). */
  async function once(): Promise<boolean> {
    const db = deps.db();
    const token = deps.token();
    if (!db || !token) return false;

    // A table the user may no longer keep leaves the PC.
    const keep = new Set<string>(tables());
    for (const table of Object.keys(LOCAL_TABLES) as LocalTable[]) {
      if (!keep.has(table) && db.getSyncState(table).since !== null) db.dropTable(table);
    }

    if (!(await push(db, token))) return false;
    try {
      await deps.between?.(db, token);
    } catch (error) {
      console.error("[sync] keeping numbers and school details", error);
    }
    if (!(await pull(db, token))) return false;
    error = null;
    db.setMeta("lastSynced", new Date().toISOString());
    return true;
  }

  /** An answer that ends the run. Returns false when it does. */
  function settle<T>(reply: Reply<T>): reply is Extract<Reply<T>, { kind: "ok" }> {
    if (reply.kind === "offline") {
      deps.offline();
      return false;
    }
    deps.online();
    if (reply.kind === "refused") {
      if (reply.status === 401) deps.unauthorized();
      else error = reply.message;
      return false;
    }
    return true;
  }

  async function push(db: LocalDb, token: string): Promise<boolean> {
    const sent = new Set<string>();
    for (;;) {
      // Never the same op twice in one run: a busy one waits for the next.
      const ops = db.waitingOps(PUSH_BATCH + sent.size).filter((op) => !sent.has(op.opId)).slice(0, PUSH_BATCH);
      if (ops.length === 0) return true;
      const reply = await deps.server.push(token, ops);
      if (!settle(reply)) return false;

      const byId = new Map(ops.map((op) => [op.opId, op]));
      for (const result of reply.data.results) {
        const op = byId.get(result.opId);
        if (!op) continue;
        sent.add(op.opId);
        if (result.status === "applied" || result.status === "duplicate") db.completeOp(op, result.result);
        else if (!(result.status === "error" && BUSY.test(result.message ?? ""))) {
          db.refuseOp(op.opId, result.message ?? "The server did not accept this change.");
        }
      }
      for (const op of ops) sent.add(op.opId);
      deps.changed();
    }
  }

  async function pull(db: LocalDb, token: string): Promise<boolean> {
    const allowed = tables();
    if (allowed.length === 0) return true;

    // Deletions first: their watermark is then older than any row the tables bring.
    for (;;) {
      const state = db.getSyncState(TOMBSTONES);
      const reply = await deps.server.pull(token, { tables: [], tombstones: { since: state.since, cursor: state.cursor, limit: PAGE } });
      if (!settle(reply)) return false;
      const page = reply.data.tombstones;
      if (!page) break;
      if (page.reset) {
        // Away longer than the server keeps deletions: start the copy afresh.
        db.resetMirror();
        continue;
      }
      db.saveTombstones(page);
      if (!page.cursor) break;
    }

    for (const table of allowed) {
      for (;;) {
        const state = db.getSyncState(table);
        const reply = await deps.server.pull(token, { tables: [{ table, since: state.since, cursor: state.cursor, limit: PAGE }] });
        if (!settle(reply)) return false;
        const page = reply.data.tables[table];
        if (!page) break;
        db.savePage(table, page);
        downloaded += page.rows.length;
        if (page.rows.length > 0) deps.changed();
        if (!page.cursor) break;
      }
    }
    return true;
  }

  function status(): SyncStatus {
    const db = deps.db();
    if (!db) return { available: false, running: false, firstSyncDone: false, downloaded: 0, waiting: 0, issues: [], lastSynced: null, error: null };
    return {
      available: true,
      running: running !== null,
      firstSyncDone: db.firstSyncDone(tables()),
      downloaded,
      waiting: db.outboxCount(),
      issues: db.issues(),
      lastSynced: db.getMeta("lastSynced"),
      error,
    };
  }

  return { run, status, idle: () => running ?? Promise.resolve() };
}

export type Sync = ReturnType<typeof createSync>;
