import Database from "better-sqlite3-multiple-ciphers";
import { randomUUID } from "node:crypto";
import type { AttendanceSetup, Register, SyncIssue } from "../shared/types";
import { REGISTER_MAX, registerKey, type AttendanceMarkPayload } from "../shared/register";

/**
 * The PC's offline copy of the school (docs/DESKTOP-PLAN.md §3, D3), in an
 * encrypted SQLite file:
 *
 * - a **mirror** of each table the server lets this user keep, filled only
 *   by the pull, so it is always the server's copy as of the last sync;
 * - the **outbox**: changes saved here and not yet on the server. Screens
 *   show the mirror with the outbox laid over it, so a change shows at once
 *   and the pull never overwrites something still waiting to be sent.
 *
 * No Electron here: main.ts opens the file and supplies the key, and the
 * tests use this directly.
 */

type Row = Record<string, unknown>;

/**
 * The tables kept on the PC and the columns each is queried by. Each row is
 * also kept whole (`data`), so a later phase can read a column without a
 * migration. Keys are the pull's (camelCase); columns are snake_case.
 */
export const LOCAL_TABLES = {
  academic_sessions: ["name", "startsOn", "endsOn", "isCurrent", "archivedAt"],
  classes: ["sessionId", "name", "nameUr", "levelOrder", "archivedAt"],
  sections: ["classId", "name", "archivedAt"],
  students: ["admissionNo", "firstName", "lastName", "status", "fatherName"],
  guardians: [],
  student_guardians: [],
  enrollments: ["studentId", "sessionId", "classId", "sectionId", "rollNo", "status", "enrolledOn"],
  attendance_statuses: ["code", "label", "labelUr", "effect"],
  attendance: ["enrollmentId", "attendanceDate", "period", "statusId"],
  // Phase 4: fee collection.
  money_accounts: ["name", "kind", "isDefault", "archived"],
  fee_heads: ["name", "nameUr", "code", "archivedAt"],
  fee_charges: ["enrollmentId", "feeHeadId", "periodLabel", "netAmount", "dueDate", "status"],
  payments: ["studentId", "amount", "method", "accountId", "reference", "paidOn", "reversesId"],
  payment_allocations: ["paymentId", "feeChargeId", "amount"],
  receipts: ["paymentId", "receiptNo", "issuedAt", "isCancelled"],
} as const satisfies Record<string, readonly string[]>;

/** The tables as migration 1 made them; later migrations change them from there. */
const V1_TABLES: Record<string, readonly string[]> = {
  academic_sessions: LOCAL_TABLES.academic_sessions,
  classes: LOCAL_TABLES.classes,
  sections: LOCAL_TABLES.sections,
  students: ["admissionNo", "firstName", "lastName", "status"],
  guardians: [],
  student_guardians: [],
  enrollments: LOCAL_TABLES.enrollments,
  attendance_statuses: LOCAL_TABLES.attendance_statuses,
  attendance: LOCAL_TABLES.attendance,
};

const createTable = (table: string, keys: readonly string[]) =>
  `create table ${table} (id text primary key, ${keys.map((k) => snake(k)).join(", ")}${keys.length ? ", " : ""}data text not null)`;

export type LocalTable = keyof typeof LOCAL_TABLES;
export const isLocalTable = (name: string): name is LocalTable => Object.hasOwn(LOCAL_TABLES, name);

/** The tombstones' own place in sync_state. */
export const TOMBSTONES = "__tombstones";

function snake(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
const toSql = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);

const MIGRATIONS: string[] = [
  // 1: Phase 3, attendance.
  [
    `create table meta (key text primary key, value text)`,
    `create table sync_state (tbl text primary key, since text, cursor text, page_time text)`,
    `create table outbox (
       seq integer primary key autoincrement,
       op_id text not null unique,
       action text not null,
       payload text not null,
       register_key text,
       title text not null,
       created_at text not null,
       status text not null default 'waiting' check (status in ('waiting', 'issue')),
       message text
     )`,
    `create index outbox_register_idx on outbox(register_key)`,
    ...Object.entries(V1_TABLES).map(([table, keys]) => createTable(table, keys)),
    `create index classes_session_idx on classes(session_id)`,
    `create index sections_class_idx on sections(class_id)`,
    `create index enrollments_section_idx on enrollments(section_id)`,
    // The server's own unique key: one mark per student per day per period.
    `create unique index attendance_natural_key on attendance(enrollment_id, attendance_date, ifnull(period, 0))`,
  ].join(";\n"),
  // 2: Phase 4, fee collection.
  [
    `alter table students add column father_name`,
    // Students were kept without the father's name; download them again with it.
    `delete from sync_state where tbl = 'students'`,
    ...(["money_accounts", "fee_heads", "fee_charges", "payments", "payment_allocations", "receipts"] as const).map((t) => createTable(t, LOCAL_TABLES[t])),
    `create index fee_charges_enrollment_idx on fee_charges(enrollment_id)`,
    `create index payments_student_idx on payments(student_id)`,
    `create index payment_allocations_payment_idx on payment_allocations(payment_id)`,
    `create index payment_allocations_charge_idx on payment_allocations(fee_charge_id)`,
    `create index receipts_payment_idx on receipts(payment_id)`,
    `create index students_name_idx on students(first_name)`,
    // What a change needs on this PC only (a receipt to print), never sent.
    `alter table outbox add column local text`,
    // Numbers reserved on the server for this PC to hand out offline (D2, D9).
    `create table number_blocks (id text primary key, kind text not null, prefix text not null, first integer not null, last integer not null, next integer not null)`,
  ].join(";\n"),
];

export type OutboxOp = { opId: string; action: string; payload: Row };

/** What a payment collected here sends (the server's `payment.record`). */
export type PaymentRecordPayload = {
  studentId: string;
  amount: number;
  accountId: string | null;
  reference: string | null;
  paidOn: string;
  /** From this PC's reserved block; null when it ran out and the server is to give one. */
  receiptNo: string | null;
};
export type PaymentRecordResult = { paymentId: string; receiptId: string; receiptNo: string; allocated?: { chargeId: string; amount: number }[] };

export class LocalDb {
  readonly db: Database.Database;

  /** `hexKey` encrypts the file; leave it out only for a database in memory. */
  constructor(file: string, hexKey?: string) {
    this.db = new Database(file);
    if (hexKey) {
      if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error("The database key must be 32 bytes of hex.");
      this.db.pragma(`hexkey='${hexKey}'`);
    }
    // Reading anything proves the key: a wrong one fails here, not later.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = OFF");
    this.migrate();
  }

  close() {
    if (this.db.open) this.db.close();
  }

  private migrate() {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sync bookkeeping                                                  */
  /* ---------------------------------------------------------------- */

  getMeta(key: string): string | null {
    const row = this.db.prepare("select value from meta where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string | null) {
    if (value === null) this.db.prepare("delete from meta where key = ?").run(key);
    else this.db.prepare("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  getSyncState(table: string): { since: string | null; cursor: unknown; pageTime: string | null } {
    const row = this.db.prepare("select since, cursor, page_time from sync_state where tbl = ?").get(table) as
      | { since: string | null; cursor: string | null; page_time: string | null }
      | undefined;
    return { since: row?.since ?? null, cursor: row?.cursor ? JSON.parse(row.cursor) : null, pageTime: row?.page_time ?? null };
  }

  private setSyncState(table: string, state: { since: string | null; cursor: unknown; pageTime: string | null }) {
    this.db
      .prepare(
        `insert into sync_state (tbl, since, cursor, page_time) values (?, ?, ?, ?)
         on conflict(tbl) do update set since = excluded.since, cursor = excluded.cursor, page_time = excluded.page_time`,
      )
      .run(table, state.since, state.cursor ? JSON.stringify(state.cursor) : null, state.pageTime);
  }

  /** Has every table this user keeps been downloaded at least once? */
  firstSyncDone(tables: string[]): boolean {
    return tables.every((t) => this.getSyncState(t).since !== null);
  }

  /**
   * One page of a table from the pull, saved with where the pull got to, in
   * one transaction: a pull cut off halfway resumes from the last page.
   * When the last page is in, the first page's server time becomes the
   * table's `since` (the server's rule, src/data/sync.ts).
   */
  savePage(table: LocalTable, page: { rows: Row[]; cursor: unknown; serverTime: string }) {
    this.db.transaction(() => {
      const state = this.getSyncState(table);
      const pageTime = state.cursor ? (state.pageTime ?? page.serverTime) : page.serverTime;
      for (const row of page.rows) this.upsert(table, row);
      this.setSyncState(table, page.cursor ? { since: state.since, cursor: page.cursor, pageTime } : { since: pageTime, cursor: null, pageTime: null });
    })();
  }

  /** The tombstones' page: drop the rows the server deleted. */
  saveTombstones(page: { deleted: { table: string; id: string }[]; cursor: unknown; serverTime: string }) {
    this.db.transaction(() => {
      for (const { table, id } of page.deleted) {
        if (isLocalTable(table)) this.db.prepare(`delete from ${table} where id = ?`).run(id);
      }
      const state = this.getSyncState(TOMBSTONES);
      const pageTime = state.cursor ? (state.pageTime ?? page.serverTime) : page.serverTime;
      this.setSyncState(
        TOMBSTONES,
        page.cursor ? { since: state.since, cursor: page.cursor, pageTime } : { since: pageTime, cursor: null, pageTime: null },
      );
    })();
  }

  private upsert(table: LocalTable, row: Row) {
    const id = row.id;
    if (typeof id !== "string") return;
    const keys: readonly string[] = LOCAL_TABLES[table];
    if (table === "payment_allocations") {
      // The server's own split of a payment this PC wrote in when it was accepted.
      this.db.prepare(`delete from payment_allocations where payment_id = ? and id like 'local:%'`).run(toSql(row.paymentId));
    }
    if (table === "attendance") {
      // The server's id for a mark the PC already holds under its own: one per natural key.
      this.db
        .prepare(`delete from attendance where enrollment_id = ? and attendance_date = ? and ifnull(period, 0) = ifnull(?, 0) and id <> ?`)
        .run(toSql(row.enrollmentId), toSql(row.attendanceDate), toSql(row.period), id);
    }
    const columns = ["id", ...keys.map(snake), "data"];
    this.db
      .prepare(
        `insert into ${table} (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})
         on conflict(id) do update set ${columns.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`,
      )
      .run(id, ...keys.map((k) => toSql(row[k])), JSON.stringify(row));
  }

  /** Forget one table (the user may no longer keep it), so it downloads afresh if allowed again. */
  dropTable(table: LocalTable) {
    this.db.transaction(() => {
      this.db.prepare(`delete from ${table}`).run();
      this.db.prepare("delete from sync_state where tbl = ?").run(table);
    })();
  }

  /** The PC was away longer than the server keeps deletions: download everything again. Waiting changes are kept. */
  resetMirror() {
    this.db.transaction(() => {
      for (const table of Object.keys(LOCAL_TABLES)) this.db.prepare(`delete from ${table}`).run();
      this.db.prepare("delete from sync_state").run();
    })();
  }

  /* ---------------------------------------------------------------- */
  /* Outbox                                                            */
  /* ---------------------------------------------------------------- */

  /** Changes not yet on the server, waiting or refused. */
  outboxCount(): number {
    return (this.db.prepare("select count(*) as n from outbox").get() as { n: number }).n;
  }

  /** The next changes to send, oldest first. Refused ones wait for someone to retry them. */
  waitingOps(limit: number): OutboxOp[] {
    const rows = this.db.prepare("select op_id, action, payload from outbox where status = 'waiting' order by seq limit ?").all(limit) as {
      op_id: string;
      action: string;
      payload: string;
    }[];
    return rows.map((r) => ({ opId: r.op_id, action: r.action, payload: JSON.parse(r.payload) }));
  }

  /**
   * The server has it. It leaves the outbox, and the mirror takes it at
   * once, so the screen doesn't flick back until the next pull brings the
   * server's own rows.
   */
  completeOp(op: OutboxOp, result?: unknown) {
    this.db.transaction(() => {
      this.db.prepare("delete from outbox where op_id = ?").run(op.opId);
      if (op.action === "attendance.mark") this.mirrorRegister(op.payload as AttendanceMarkPayload);
      if (op.action === "payment.record" && result) this.mirrorPayment(op.opId, op.payload as PaymentRecordPayload, result as PaymentRecordResult);
    })();
  }

  /** A payment the server accepted, written in until the pull brings the server's rows. */
  private mirrorPayment(opId: string, payload: PaymentRecordPayload, result: PaymentRecordResult) {
    if (typeof result.paymentId !== "string" || typeof result.receiptId !== "string") return;
    // A receipt on screen was opened by its change's id; it still finds its payment.
    this.setMeta(`sent:${opId}`, result.paymentId);
    this.upsert("payments", { id: result.paymentId, studentId: payload.studentId, amount: payload.amount, accountId: payload.accountId, reference: payload.reference, paidOn: payload.paidOn, method: null, reversesId: null });
    this.upsert("receipts", { id: result.receiptId, paymentId: result.paymentId, receiptNo: result.receiptNo, issuedAt: new Date().toISOString(), isCancelled: false });
    for (const a of result.allocated ?? []) {
      this.db
        .prepare("insert into payment_allocations (id, payment_id, fee_charge_id, amount, data) values (?, ?, ?, ?, '{}')")
        .run(`local:${randomUUID()}`, result.paymentId, a.chargeId, a.amount);
    }
  }

  /** The server refused it: it stays, shown in Sync issues, until retried or discarded. */
  refuseOp(opId: string, message: string) {
    this.db.prepare("update outbox set status = 'issue', message = ? where op_id = ?").run(message, opId);
  }

  retryOp(opId: string) {
    this.db.prepare("update outbox set status = 'waiting', message = null where op_id = ?").run(opId);
  }

  discardOp(opId: string) {
    this.db.prepare("delete from outbox where op_id = ?").run(opId);
  }

  issues(): SyncIssue[] {
    const rows = this.db
      .prepare("select op_id, action, title, message, created_at from outbox where status = 'issue' order by seq")
      .all() as { op_id: string; action: string; title: string; message: string | null; created_at: string }[];
    return rows.map((r) => ({ opId: r.op_id, action: r.action, title: r.title, message: r.message ?? "", createdAt: r.created_at }));
  }

  /* ---------------------------------------------------------------- */
  /* Attendance                                                        */
  /* ---------------------------------------------------------------- */

  attendanceSetup(permissions: { canView: boolean; canMark: boolean; canEdit: boolean }, today: string): AttendanceSetup {
    const session = this.db
      .prepare("select id, name from academic_sessions where is_current = 1 and archived_at is null limit 1")
      .get() as { id: string; name: string } | undefined;
    const sections = session
      ? (this.db
          .prepare(
            `select s.id, c.name || ' — ' || s.name as label
             from sections s join classes c on c.id = s.class_id
             where c.session_id = ? and s.archived_at is null and c.archived_at is null
             order by c.level_order, s.name`,
          )
          .all(session.id) as { id: string; label: string }[])
      : [];
    const statuses = this.db
      .prepare("select id, code, label, label_ur as labelUr, effect from attendance_statuses order by code")
      .all() as AttendanceSetup["statuses"];
    return { session: session ?? null, sections, statuses, today, ...permissions };
  }

  /** A section's register for a day: the server's marks, with any change still waiting laid over them. */
  register(sectionId: string, date: string): Register {
    const rows = this.db
      .prepare(
        `select e.id as enrollmentId, s.first_name, s.last_name, s.admission_no as admissionNo, e.roll_no as rollNo, a.status_id as statusId
         from enrollments e
         join students s on s.id = e.student_id
         left join attendance a on a.enrollment_id = e.id and a.attendance_date = ? and a.period is null
         where e.section_id = ? and e.status = 'active' and e.enrolled_on <= ?
         order by e.roll_no is null, e.roll_no, s.first_name`,
      )
      .all(date, sectionId, date) as { enrollmentId: string; first_name: string; last_name: string | null; admissionNo: string; rollNo: number | null; statusId: string | null }[];

    const entries = rows.map((r) => ({
      enrollmentId: r.enrollmentId,
      name: [r.first_name, r.last_name].filter(Boolean).join(" "),
      admissionNo: r.admissionNo,
      rollNo: r.rollNo,
      statusId: r.statusId,
    }));

    const ops = this.db
      .prepare("select payload, status, message from outbox where register_key = ? order by seq")
      .all(registerKey(sectionId, date)) as { payload: string; status: string; message: string | null }[];
    let issue: string | null = null;
    for (const op of ops) {
      const marks = new Map((JSON.parse(op.payload) as AttendanceMarkPayload).entries.map((e) => [e.enrollmentId, e.statusId]));
      for (const entry of entries) entry.statusId = marks.get(entry.enrollmentId) ?? entry.statusId;
      issue = op.status === "issue" ? (op.message ?? "") : null;
    }
    return { sectionId, date, entries, waiting: ops.length > 0, issue };
  }

  /**
   * Save a register: one change in the outbox (D8, one write path). A newer
   * save of the same register replaces an older one still waiting, since
   * each carries the whole register.
   */
  saveRegister(input: { sectionId: string; date: string; savedOn: string; entries: { enrollmentId: string; statusId: string }[] }): { ok: true; opId: string } | { ok: false; message: string } {
    if (input.entries.length === 0) return { ok: false, message: "nothingMarked" };
    if (input.entries.length > REGISTER_MAX) return { ok: false, message: "tooMany" };

    const inSection = new Set(
      (this.db.prepare("select id from enrollments where section_id = ? and status = 'active'").all(input.sectionId) as { id: string }[]).map((r) => r.id),
    );
    const statuses = new Set((this.db.prepare("select id from attendance_statuses").all() as { id: string }[]).map((r) => r.id));
    if (input.entries.some((e) => !inSection.has(e.enrollmentId) || !statuses.has(e.statusId))) return { ok: false, message: "stale" };

    const label = this.db
      .prepare("select c.name || ' — ' || s.name as label from sections s join classes c on c.id = s.class_id where s.id = ?")
      .get(input.sectionId) as { label: string } | undefined;
    const payload: AttendanceMarkPayload = { sectionId: input.sectionId, date: input.date, period: null, savedOn: input.savedOn, entries: input.entries };
    const key = registerKey(input.sectionId, input.date);
    const opId = randomUUID();

    this.db.transaction(() => {
      this.db.prepare("delete from outbox where register_key = ?").run(key);
      this.db
        .prepare("insert into outbox (op_id, action, payload, register_key, title, created_at) values (?, 'attendance.mark', ?, ?, ?, ?)")
        .run(opId, JSON.stringify(payload), key, `${label?.label ?? ""} · ${input.date}`, new Date().toISOString());
    })();
    return { ok: true, opId };
  }

  /** A register the server accepted, written into the mirror until the pull brings the server's rows. */
  private mirrorRegister(payload: AttendanceMarkPayload) {
    for (const e of payload.entries) {
      const row = this.db
        .prepare("select id from attendance where enrollment_id = ? and attendance_date = ? and period is null")
        .get(e.enrollmentId, payload.date) as { id: string } | undefined;
      this.upsert("attendance", {
        id: row?.id ?? `local:${randomUUID()}`,
        enrollmentId: e.enrollmentId,
        attendanceDate: payload.date,
        period: null,
        statusId: e.statusId,
      });
    }
  }
}
