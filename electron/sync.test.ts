import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDb } from "./localdb";
import { createSync, type SyncServer } from "./sync";

/**
 * The offline copy and the sync engine, against a fake server that keeps
 * its rows in memory and answers the way src/data/sync.ts in the ilmways
 * repo does: pages ordered by update time, a first-page serverTime, and a
 * push that runs one handler per op.
 */

const id = () => randomUUID();
const sessionId = id();
const classId = id();
const sectionId = id();
const present = id();
const absent = id();
const students = [id(), id(), id()];
const enrollments = students.map(() => id());

function school() {
  return {
    academic_sessions: [{ id: sessionId, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true, archivedAt: null }],
    classes: [{ id: classId, sessionId, name: "Class 5", nameUr: null, levelOrder: 5, archivedAt: null }],
    sections: [{ id: sectionId, classId, name: "A", archivedAt: null }],
    students: students.map((s, i) => ({ id: s, admissionNo: `A-${i + 1}`, firstName: ["Ali", "Sara", "Omar"][i], lastName: "Khan", status: "active" })),
    enrollments: enrollments.map((e, i) => ({
      id: e,
      studentId: students[i],
      sessionId,
      classId,
      sectionId,
      rollNo: i + 1,
      status: "active",
      enrolledOn: "2026-04-01",
    })),
    attendance_statuses: [
      { id: present, code: "P", label: "Present", labelUr: null, effect: "present" },
      { id: absent, code: "A", label: "Absent", labelUr: null, effect: "absent" },
    ],
    attendance: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>;
}

function fakeServer(rows = school()) {
  let clock = 1000;
  let online = true;
  const pages: number[] = [];
  const pushed: string[] = [];
  const stamped = new Map<string, number>();
  for (const list of Object.values(rows)) for (const r of list) stamped.set(r.id as string, clock++);
  const deleted: { table: string; id: string; at: number }[] = [];
  let refuse: string | null = null;

  const server: SyncServer = {
    async pull(_token, body) {
      if (!online) return { kind: "offline" };
      const serverTime = String(clock++).padStart(10, "0");
      const tables: Record<string, { rows: Record<string, unknown>[]; cursor: unknown; serverTime: string }> = {};
      for (const t of body.tables) {
        const since = t.since ? Number(t.since) : -1;
        const after = (t.cursor as { at: number; id: string } | null)?.at ?? -1;
        const all = (rows[t.table] ?? [])
          .map((r) => ({ r, at: stamped.get(r.id as string)! }))
          .filter(({ at }) => at >= since && at > after)
          .sort((a, b) => a.at - b.at);
        const page = all.slice(0, t.limit);
        pages.push(page.length);
        tables[t.table] = {
          rows: page.map(({ r }) => r),
          cursor: all.length > t.limit ? { at: page[page.length - 1].at, id: page[page.length - 1].r.id } : null,
          serverTime,
        };
      }
      const tombstones = body.tombstones
        ? {
            deleted: body.tombstones.since ? deleted.filter((d) => d.at >= Number(body.tombstones!.since)).map(({ table, id }) => ({ table, id })) : [],
            cursor: null,
            serverTime,
            reset: false,
          }
        : null;
      return { kind: "ok", data: { tables, tombstones } };
    },
    async push(_token, ops) {
      if (!online) return { kind: "offline" };
      const results = ops.map((op) => {
        pushed.push(op.opId);
        if (refuse) return { opId: op.opId, status: "error" as const, message: refuse };
        const p = op.payload as { date: string; entries: { enrollmentId: string; statusId: string }[] };
        for (const e of p.entries) {
          const existing = rows.attendance.find((a) => a.enrollmentId === e.enrollmentId && a.attendanceDate === p.date && a.period === null);
          if (existing) existing.statusId = e.statusId;
          const row = existing ?? { id: id(), enrollmentId: e.enrollmentId, attendanceDate: p.date, period: null, statusId: e.statusId };
          if (!existing) rows.attendance.push(row);
          stamped.set(row.id as string, clock++);
        }
        return { opId: op.opId, status: "applied" as const };
      });
      return { kind: "ok", data: { results } };
    },
  };
  return {
    server,
    rows,
    pages,
    pushed,
    setOnline: (value: boolean) => (online = value),
    refuseWith: (message: string | null) => (refuse = message),
    remove(table: string, rowId: string) {
      rows[table] = rows[table].filter((r) => r.id !== rowId);
      deleted.push({ table, id: rowId, at: clock++ });
    },
    touch(table: string, rowId: string, change: Record<string, unknown>) {
      Object.assign(rows[table].find((r) => r.id === rowId)!, change);
      stamped.set(rowId, clock++);
    },
  };
}

const TABLES = ["academic_sessions", "classes", "sections", "students", "enrollments", "attendance_statuses", "attendance"];

function setup(server = fakeServer()) {
  const db = new LocalDb(":memory:");
  const events = { offline: 0, unauthorized: 0 };
  const sync = createSync({
    db: () => db,
    server: server.server,
    token: () => "token",
    tables: () => TABLES,
    changed: () => {},
    unauthorized: () => events.unauthorized++,
    offline: () => events.offline++,
    online: () => {},
  });
  return { db, sync, server, events };
}

const today = "2026-11-27";
const statusesOf = (db: LocalDb) => db.register(sectionId, today).entries.map((e) => e.statusId);

describe("first sync", () => {
  it("downloads the school and opens the register", async () => {
    const { db, sync } = setup();
    expect(sync.status().firstSyncDone).toBe(false);
    await sync.run();
    expect(sync.status().firstSyncDone).toBe(true);

    const setupInfo = db.attendanceSetup({ canView: true, canMark: true, canEdit: false }, today);
    expect(setupInfo.session?.name).toBe("2026-27");
    expect(setupInfo.sections).toEqual([{ id: sectionId, label: "Class 5 — A" }]);
    expect(setupInfo.statuses.map((s) => s.code)).toEqual(["A", "P"]);
    expect(db.register(sectionId, today).entries.map((e) => e.name)).toEqual(["Ali Khan", "Sara Khan", "Omar Khan"]);
  });

  it("pages through a large table and resumes where it was cut off", async () => {
    const big = school();
    big.students = Array.from({ length: 4500 }, (_, i) => ({ id: id(), admissionNo: `B-${i}`, firstName: "S", lastName: null, status: "active" }));
    const server = fakeServer(big);
    const { db, sync } = setup(server);

    // Cut off after the first page of students.
    let calls = 0;
    const pull = server.server.pull;
    server.server.pull = async (token, body) => {
      if (body.tables[0]?.table === "students" && ++calls === 2) return { kind: "offline" };
      return pull(token, body);
    };
    await sync.run();
    expect(db.firstSyncDone(TABLES)).toBe(false);
    expect((db.db.prepare("select count(*) as n from students").get() as { n: number }).n).toBe(2000);

    await sync.run();
    expect(db.firstSyncDone(TABLES)).toBe(true);
    expect((db.db.prepare("select count(*) as n from students").get() as { n: number }).n).toBe(4500);
  });
});

describe("marking a register", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.sync.run();
  });

  it("shows a save at once, offline, and sends it when the internet is back", async () => {
    ctx.server.setOnline(false);
    const saved = ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: enrollments.map((e) => ({ enrollmentId: e, statusId: present })) });
    expect(saved.ok).toBe(true);
    expect(statusesOf(ctx.db)).toEqual([present, present, present]);
    expect(ctx.db.register(sectionId, today).waiting).toBe(true);

    await ctx.sync.run();
    expect(ctx.events.offline).toBe(1);
    expect(ctx.sync.status().waiting).toBe(1);

    ctx.server.setOnline(true);
    await ctx.sync.run();
    expect(ctx.sync.status().waiting).toBe(0);
    expect(ctx.server.rows.attendance).toHaveLength(3);
    // The pull brought the server's own rows, under the server's ids.
    const local = ctx.db.db.prepare("select id from attendance").all() as { id: string }[];
    expect(local.map((r) => r.id).sort()).toEqual(ctx.server.rows.attendance.map((r) => r.id as string).sort());
    expect(statusesOf(ctx.db)).toEqual([present, present, present]);
    expect(ctx.db.register(sectionId, today).waiting).toBe(false);
  });

  it("sends the newest save of a register, once", async () => {
    ctx.server.setOnline(false);
    ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: enrollments[0], statusId: present }] });
    ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: enrollments[0], statusId: absent }] });
    expect(ctx.sync.status().waiting).toBe(1);
    ctx.server.setOnline(true);
    await ctx.sync.run();
    expect(ctx.server.pushed).toHaveLength(1);
    expect(ctx.server.rows.attendance[0].statusId).toBe(absent);
  });

  it("never lets the download overwrite a change still waiting", async () => {
    ctx.server.refuseWith("Only today's attendance can be marked with your permissions.");
    ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: enrollments[0], statusId: absent }] });
    // Someone marks the same student present on the web meanwhile.
    ctx.server.rows.attendance.push({ id: id(), enrollmentId: enrollments[0], attendanceDate: today, period: null, statusId: present });
    await ctx.sync.run();

    const register = ctx.db.register(sectionId, today);
    expect(register.entries[0].statusId).toBe(absent);
    expect(register.issue).toMatch(/Only today's/);
    expect(ctx.sync.status().issues).toHaveLength(1);
    expect(ctx.sync.status().issues[0].title).toBe(`Class 5 — A · ${today}`);
  });

  it("keeps a refused change until it is retried or discarded", async () => {
    ctx.server.refuseWith("No.");
    ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: enrollments[0], statusId: absent }] });
    await ctx.sync.run();
    await ctx.sync.run();
    expect(ctx.server.pushed).toHaveLength(1); // not resent on its own

    const [issue] = ctx.sync.status().issues;
    ctx.server.refuseWith(null);
    ctx.db.retryOp(issue.opId);
    await ctx.sync.run();
    expect(ctx.sync.status().issues).toHaveLength(0);
    expect(ctx.sync.status().waiting).toBe(0);

    ctx.server.refuseWith("No.");
    ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: enrollments[1], statusId: absent }] });
    await ctx.sync.run();
    ctx.db.discardOp(ctx.sync.status().issues[0].opId);
    expect(ctx.sync.status().waiting).toBe(0);
  });

  it("refuses a register for students no longer in the section", () => {
    expect(ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [{ enrollmentId: id(), statusId: present }] })).toEqual({ ok: false, message: "stale" });
    expect(ctx.db.saveRegister({ sectionId, date: today, savedOn: today, entries: [] })).toEqual({ ok: false, message: "nothingMarked" });
  });
});

describe("keeping up with the server", () => {
  it("brings changes and deletions made elsewhere", async () => {
    const { db, sync, server } = setup();
    await sync.run();
    server.touch("students", students[0], { firstName: "Aliya" });
    server.remove("enrollments", enrollments[2]);
    await sync.run();
    expect(db.register(sectionId, today).entries.map((e) => e.name)).toEqual(["Aliya Khan", "Sara Khan"]);
  });

  it("drops a table the user may no longer keep", async () => {
    let tables = TABLES;
    const server = fakeServer();
    const db = new LocalDb(":memory:");
    const sync = createSync({ db: () => db, server: server.server, token: () => "t", tables: () => tables, changed() {}, unauthorized() {}, offline() {}, online() {} });
    await sync.run();
    tables = TABLES.filter((t) => t !== "attendance" && t !== "students" && t !== "enrollments");
    await sync.run();
    expect((db.db.prepare("select count(*) as n from students").get() as { n: number }).n).toBe(0);
  });

  it("signs the PC out when the server no longer knows it", async () => {
    const ctx = setup();
    ctx.server.server.pull = async () => ({ kind: "refused", status: 401, code: "UNAUTHENTICATED", message: "Please sign in again." });
    await ctx.sync.run();
    expect(ctx.events.unauthorized).toBe(1);
  });
});

describe("the database file", () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "ilmways-db-"))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is encrypted, and opens only with its key", () => {
    const file = path.join(dir, "offline.db");
    const key = randomBytes(32).toString("hex");
    const db = new LocalDb(file, key);
    db.setMeta("hello", "world");
    db.close();

    expect(fs.readFileSync(file).subarray(0, 15).toString()).not.toBe("SQLite format 3");
    expect(() => new LocalDb(file, randomBytes(32).toString("hex"))).toThrow();
    const reopened = new LocalDb(file, key);
    expect(reopened.getMeta("hello")).toBe("world");
    reopened.close();
  });
});
