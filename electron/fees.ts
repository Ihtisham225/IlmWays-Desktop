import { randomUUID } from "node:crypto";
import type { CollectInput, CollectResult, FeeSetup, Ledger, LedgerCharge, LedgerPayment, ReceiptView, SchoolInfo, StudentHit } from "../shared/types";
import { allocateOldestFirst, formatReceiptNo } from "../shared/fees";
import type { LocalDb, PaymentRecordPayload } from "./localdb";

/**
 * Fee collection on the PC (Phase 4): the web's collect screen
 * (src/app/(app)/fees/collect) from the offline copy. A payment is one
 * change in the outbox, sent at once when online, with a receipt number
 * from this PC's reserved block so the receipt it prints is final.
 *
 * Balances are the web's: outstanding = a charge's net amount less what has
 * been allocated to it; never stored. Payments still waiting here are laid
 * over the server's copy, allocated oldest-first as the server will.
 */

/** What this PC keeps about a waiting payment, beside what it sends. */
type PaymentLocal = { allocations: { chargeId: string; amount: number }[]; advance: number; receiptNo: string | null };

type Pending = { opId: string; status: string; createdAt: string; payload: PaymentRecordPayload; local: PaymentLocal };

const SCHOOL = "school";

export function saveSchool(db: LocalDb, school: SchoolInfo) {
  db.setMeta(SCHOOL, JSON.stringify(school));
}

export function school(db: LocalDb): SchoolInfo | null {
  const raw = db.getMeta(SCHOOL);
  return raw ? (JSON.parse(raw) as SchoolInfo) : null;
}

export function feeSetup(db: LocalDb, permissions: { canCollect: boolean }, today: string): FeeSetup {
  const accounts = db.db
    .prepare("select id, name, is_default as isDefault from money_accounts where archived = 0 or archived is null order by is_default desc, name")
    .all() as { id: string; name: string; isDefault: number }[];
  return {
    currency: school(db)?.currency ?? "PKR",
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, isDefault: Boolean(a.isDefault) })),
    today,
    canCollect: permissions.canCollect,
    receiptsLeft: receiptsLeft(db),
  };
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

const STUDENT = `
  select s.id as studentId, s.first_name, s.last_name, s.admission_no as admissionNo, s.father_name as fatherName,
    (select c.name || ' — ' || sc.name from enrollments e
       join sections sc on sc.id = e.section_id join classes c on c.id = e.class_id
       join academic_sessions se on se.id = e.session_id
     where e.student_id = s.id order by se.is_current desc, se.starts_on desc limit 1) as classLabel
  from students s`;

type StudentRow = { studentId: string; first_name: string; last_name: string | null; admissionNo: string; fatherName: string | null; classLabel: string | null };
const hit = (r: StudentRow): StudentHit => ({
  studentId: r.studentId,
  name: [r.first_name, r.last_name].filter(Boolean).join(" "),
  admissionNo: r.admissionNo,
  fatherName: r.fatherName,
  classLabel: r.classLabel,
});

/** By name, father's name or admission number, as the web's student search. */
export function searchStudents(db: LocalDb, query: string): StudentHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = db.db
    .prepare(
      `${STUDENT}
       where lower(s.first_name || ' ' || ifnull(s.last_name, '')) like ? escape '\\'
          or lower(ifnull(s.father_name, '')) like ? escape '\\'
          or lower(s.admission_no) like ? escape '\\'
       order by (lower(s.admission_no) = ?) desc, s.status = 'active' desc, s.first_name
       limit 30`,
    )
    .all(like, like, like, q) as StudentRow[];
  return rows.map(hit);
}

function studentById(db: LocalDb, studentId: string): StudentHit | null {
  const row = db.db.prepare(`${STUDENT} where s.id = ?`).get(studentId) as StudentRow | undefined;
  return row ? hit(row) : null;
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

function pendingFor(db: LocalDb, studentId: string): Pending[] {
  const rows = db.db
    .prepare("select op_id, status, created_at, payload, local from outbox where action = 'payment.record' order by seq")
    .all() as { op_id: string; status: string; created_at: string; payload: string; local: string | null }[];
  return rows
    .map((r) => ({ opId: r.op_id, status: r.status, createdAt: r.created_at, payload: JSON.parse(r.payload) as PaymentRecordPayload, local: JSON.parse(r.local ?? "{}") as PaymentLocal }))
    .filter((p) => p.payload.studentId === studentId);
}

function serverCharges(db: LocalDb, studentId: string) {
  return db.db
    .prepare(
      `select c.id, ifnull(h.name, '') as head, c.period_label as period, c.due_date as dueDate, c.net_amount as net,
         ifnull((select sum(a.amount) from payment_allocations a where a.fee_charge_id = c.id), 0) as paid
       from fee_charges c
       join enrollments e on e.id = c.enrollment_id
       left join fee_heads h on h.id = c.fee_head_id
       where e.student_id = ? and c.status <> 'cancelled'
       order by c.due_date, c.id`,
    )
    .all(studentId) as { id: string; head: string; period: string; dueDate: string; net: number; paid: number }[];
}

export function ledger(db: LocalDb, studentId: string): Ledger | null {
  const student = studentById(db, studentId);
  if (!student) return null;
  const pending = pendingFor(db, studentId);

  const waitingOn = new Map<string, number>();
  for (const p of pending) for (const a of p.local.allocations ?? []) waitingOn.set(a.chargeId, (waitingOn.get(a.chargeId) ?? 0) + a.amount);

  const charges: LedgerCharge[] = serverCharges(db, studentId).map((c) => {
    const waiting = waitingOn.get(c.id) ?? 0;
    return { ...c, waiting, outstanding: Math.max(0, c.net - c.paid - waiting) };
  });

  const synced = db.db
    .prepare(
      `select p.id, p.amount, p.paid_on as paidOn, r.receipt_no as receiptNo, ifnull(r.is_cancelled, 0) as cancelled, p.reverses_id as reversesId
       from payments p left join receipts r on r.payment_id = p.id
       where p.student_id = ? order by p.paid_on desc, r.receipt_no desc`,
    )
    .all(studentId) as { id: string; amount: number; paidOn: string; receiptNo: string | null; cancelled: number; reversesId: string | null }[];
  const allocated = (
    db.db
      .prepare("select ifnull(sum(a.amount), 0) as n from payment_allocations a join payments p on p.id = a.payment_id where p.student_id = ?")
      .get(studentId) as { n: number }
  ).n;
  const paidIn = synced.reduce((sum, p) => sum + p.amount, 0);

  const payments: LedgerPayment[] = [
    ...pending.reverse().map((p) => ({
      key: `op:${p.opId}`,
      receiptNo: p.local.receiptNo,
      amount: p.payload.amount,
      paidOn: p.payload.paidOn,
      state: p.status === "issue" ? ("issue" as const) : ("waiting" as const),
      cancelled: false,
    })),
    ...synced
      .filter((p) => !p.reversesId)
      .map((p) => ({ key: `payment:${p.id}`, receiptNo: p.receiptNo, amount: p.amount, paidOn: p.paidOn, state: "synced" as const, cancelled: Boolean(p.cancelled) })),
  ];

  return {
    student,
    charges,
    payments,
    outstanding: charges.reduce((sum, c) => sum + c.outstanding, 0),
    advance: Math.max(0, paidIn - allocated) + pending.reduce((sum, p) => sum + (p.local.advance ?? 0), 0),
  };
}

/* ------------------------------------------------------------------ */
/* Receipt numbers (D2)                                                */
/* ------------------------------------------------------------------ */

export function receiptsLeft(db: LocalDb): number {
  return (db.db.prepare("select ifnull(sum(last - next + 1), 0) as n from number_blocks where kind = 'receipt' and next <= last").get() as { n: number }).n;
}

export function addReceiptBlock(db: LocalDb, block: { id: string; prefix: string; first: number; last: number }) {
  db.db
    .prepare("insert or ignore into number_blocks (id, kind, prefix, first, last, next) values (?, 'receipt', ?, ?, ?, ?)")
    .run(block.id, block.prefix, block.first, block.last, block.first);
}

/** The next reserved receipt number, used up; null when this PC holds none. */
function takeReceiptNo(db: LocalDb): string | null {
  const block = db.db
    .prepare("select id, prefix, next from number_blocks where kind = 'receipt' and next <= last order by first limit 1")
    .get() as { id: string; prefix: string; next: number } | undefined;
  if (!block) return null;
  db.db.prepare("update number_blocks set next = next + 1 where id = ?").run(block.id);
  return formatReceiptNo(block.prefix, block.next);
}

/* ------------------------------------------------------------------ */
/* Collecting                                                          */
/* ------------------------------------------------------------------ */

/** One payment: saved here first, with its receipt, and sent at once when online (D8). */
export function collect(db: LocalDb, input: CollectInput, today: string): CollectResult & { opId?: string } {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return { ok: false, message: "badAmount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || input.paidOn > today) return { ok: false, message: "badDate" };
  const current = ledger(db, input.studentId);
  if (!current) return { ok: false, message: "stale" };
  if (input.accountId) {
    const account = db.db.prepare("select id from money_accounts where id = ?").get(input.accountId);
    if (!account) return { ok: false, message: "stale" };
  }

  const open = current.charges.map((c) => ({ id: c.id, outstanding: c.outstanding, dueDate: c.dueDate }));
  const { allocations, advance } = allocateOldestFirst(input.amount, open);
  const opId = randomUUID();

  db.db.transaction(() => {
    const receiptNo = takeReceiptNo(db);
    const payload: PaymentRecordPayload = {
      studentId: input.studentId,
      amount: input.amount,
      accountId: input.accountId,
      reference: input.reference?.trim().slice(0, 80) || null,
      paidOn: input.paidOn,
      receiptNo,
    };
    const local: PaymentLocal = { allocations, advance, receiptNo };
    db.db
      .prepare("insert into outbox (op_id, action, payload, title, created_at, local) values (?, 'payment.record', ?, ?, ?, ?)")
      .run(opId, JSON.stringify(payload), `${current.student.name} · ${receiptNo ?? ""}`.trim(), new Date().toISOString(), JSON.stringify(local));
  })();
  return { ok: true, receiptKey: `op:${opId}`, opId };
}

/* ------------------------------------------------------------------ */
/* Receipts                                                            */
/* ------------------------------------------------------------------ */

function chargeLabels(db: LocalDb, ids: string[]) {
  const labels = new Map<string, { head: string; period: string }>();
  for (const id of ids) {
    const row = db.db
      .prepare("select ifnull(h.name, '') as head, c.period_label as period from fee_charges c left join fee_heads h on h.id = c.fee_head_id where c.id = ?")
      .get(id) as { head: string; period: string } | undefined;
    labels.set(id, row ?? { head: "", period: "" });
  }
  return labels;
}

/** A receipt to show or print: `op:<opId>` for one still waiting here, `payment:<id>` once on the server. */
export function receipt(db: LocalDb, key: string): ReceiptView | null {
  const info = school(db);
  const currency = info?.currency ?? "PKR";

  if (key.startsWith("op:")) {
    const sent = db.getMeta(`sent:${key.slice(3)}`);
    if (sent) return receipt(db, `payment:${sent}`);
    const row = db.db.prepare("select payload, local, status from outbox where op_id = ? and action = 'payment.record'").get(key.slice(3)) as
      | { payload: string; local: string | null; status: string }
      | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payload) as PaymentRecordPayload;
    const local = JSON.parse(row.local ?? "{}") as PaymentLocal;
    const student = studentById(db, payload.studentId);
    if (!student) return null;
    const labels = chargeLabels(db, local.allocations.map((a) => a.chargeId));
    return {
      school: info,
      currency,
      receiptNo: local.receiptNo,
      paidOn: payload.paidOn,
      student,
      account: accountName(db, payload.accountId),
      reference: payload.reference,
      lines: local.allocations.map((a) => ({ ...labels.get(a.chargeId)!, amount: a.amount })),
      total: payload.amount,
      advance: local.advance,
      balance: ledger(db, payload.studentId)?.outstanding ?? 0,
      waiting: row.status === "waiting" || row.status === "issue",
      cancelled: false,
    };
  }

  if (key.startsWith("payment:")) {
    const row = db.db
      .prepare(
        `select p.id, p.student_id as studentId, p.amount, p.paid_on as paidOn, p.account_id as accountId, p.reference,
           r.receipt_no as receiptNo, ifnull(r.is_cancelled, 0) as cancelled
         from payments p left join receipts r on r.payment_id = p.id where p.id = ?`,
      )
      .get(key.slice(8)) as
      | { id: string; studentId: string; amount: number; paidOn: string; accountId: string | null; reference: string | null; receiptNo: string | null; cancelled: number }
      | undefined;
    if (!row) return null;
    const student = studentById(db, row.studentId);
    if (!student) return null;
    const allocations = db.db.prepare("select fee_charge_id as chargeId, amount from payment_allocations where payment_id = ?").all(row.id) as {
      chargeId: string;
      amount: number;
    }[];
    const labels = chargeLabels(db, allocations.map((a) => a.chargeId));
    const allocatedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
    return {
      school: info,
      currency,
      receiptNo: row.receiptNo,
      paidOn: row.paidOn,
      student,
      account: accountName(db, row.accountId),
      reference: row.reference,
      lines: allocations.map((a) => ({ ...labels.get(a.chargeId)!, amount: a.amount })),
      total: row.amount,
      advance: Math.max(0, row.amount - allocatedTotal),
      balance: ledger(db, row.studentId)?.outstanding ?? 0,
      waiting: false,
      cancelled: Boolean(row.cancelled),
    };
  }
  return null;
}

function accountName(db: LocalDb, id: string | null): string | null {
  if (!id) return null;
  const row = db.db.prepare("select name from money_accounts where id = ?").get(id) as { name: string } | undefined;
  return row?.name ?? null;
}
