import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalDb } from "./localdb";
import { addReceiptBlock, collect, ledger, receipt, receiptsLeft, saveSchool, searchStudents } from "./fees";

/**
 * Fee collection on the PC, from a copy filled the way the pull fills it.
 */
const id = () => randomUUID();
const today = "2026-11-28";
const ids = { session: id(), klass: id(), section: id(), student: id(), enrollment: id(), tuition: id(), april: id(), may: id(), cash: id() };

function filled() {
  const db = new LocalDb(":memory:");
  const page = (table: Parameters<LocalDb["savePage"]>[0], rows: Record<string, unknown>[]) => db.savePage(table, { rows, cursor: null, serverTime: "1" });
  page("academic_sessions", [{ id: ids.session, name: "2026-27", isCurrent: true, startsOn: "2026-04-01" }]);
  page("classes", [{ id: ids.klass, sessionId: ids.session, name: "Class 5", levelOrder: 5 }]);
  page("sections", [{ id: ids.section, classId: ids.klass, name: "A" }]);
  page("students", [{ id: ids.student, admissionNo: "DS-1001", firstName: "Hamza", lastName: "Tariq", fatherName: "Tariq Mehmood", status: "active" }]);
  page("enrollments", [{ id: ids.enrollment, studentId: ids.student, sessionId: ids.session, classId: ids.klass, sectionId: ids.section, status: "active" }]);
  page("money_accounts", [{ id: ids.cash, name: "Cash box", isDefault: true, archived: false }]);
  page("fee_heads", [{ id: ids.tuition, name: "Tuition", code: "TUI" }]);
  page("fee_charges", [
    { id: ids.april, enrollmentId: ids.enrollment, feeHeadId: ids.tuition, periodLabel: "2026-04", netAmount: 300000, dueDate: "2026-04-10", status: "unpaid" },
    { id: ids.may, enrollmentId: ids.enrollment, feeHeadId: ids.tuition, periodLabel: "2026-05", netAmount: 300000, dueDate: "2026-05-10", status: "unpaid" },
  ]);
  saveSchool(db, { name: "Demo School", nameUr: null, address: "Lahore", phone: null, logo: null, currency: "PKR" });
  return db;
}

describe("fee collection on the PC", () => {
  let db: LocalDb;
  beforeEach(() => (db = filled()));

  it("finds a student by name, father's name or admission number", () => {
    expect(searchStudents(db, "hamza")[0]?.classLabel).toBe("Class 5 — A");
    expect(searchStudents(db, "mehmood")).toHaveLength(1);
    expect(searchStudents(db, "ds-1001")).toHaveLength(1);
    expect(searchStudents(db, "nobody")).toHaveLength(0);
  });

  it("works out what is outstanding from charges and allocations, as the web does", () => {
    const paymentId = id();
    db.savePage("payments", { rows: [{ id: paymentId, studentId: ids.student, amount: 100000, paidOn: "2026-04-05" }], cursor: null, serverTime: "1" });
    db.savePage("payment_allocations", { rows: [{ id: id(), paymentId, feeChargeId: ids.april, amount: 100000 }], cursor: null, serverTime: "1" });
    const l = ledger(db, ids.student)!;
    expect(l.outstanding).toBe(500000);
    expect(l.charges.map((c) => c.outstanding)).toEqual([200000, 300000]);
  });

  it("collects offline with a reserved receipt number, and shows it at once", () => {
    addReceiptBlock(db, { id: id(), prefix: "", first: 51, last: 100 });
    const result = collect(db, { studentId: ids.student, amount: 400000, accountId: ids.cash, reference: null, paidOn: today }, today);
    expect(result.ok).toBe(true);
    expect(receiptsLeft(db)).toBe(49);

    const l = ledger(db, ids.student)!;
    expect(l.outstanding).toBe(200000);
    expect(l.payments[0]).toMatchObject({ receiptNo: "00051", state: "waiting", amount: 400000 });

    const r = receipt(db, (result as { receiptKey: string }).receiptKey)!;
    expect(r.receiptNo).toBe("00051");
    expect(r.lines).toEqual([
      { head: "Tuition", period: "2026-04", amount: 300000 },
      { head: "Tuition", period: "2026-05", amount: 100000 },
    ]);
    expect(r.balance).toBe(200000);
    expect(r.account).toBe("Cash box");
    expect(r.waiting).toBe(true);
  });

  it("prints a provisional receipt when this PC has no numbers left", () => {
    const result = collect(db, { studentId: ids.student, amount: 1000, accountId: null, reference: null, paidOn: today }, today);
    expect(receipt(db, (result as { receiptKey: string }).receiptKey)!.receiptNo).toBeNull();
  });

  it("keeps the receipt on screen once the server has the payment, and takes the server's split when it arrives", () => {
    addReceiptBlock(db, { id: id(), prefix: "", first: 51, last: 100 });
    const result = collect(db, { studentId: ids.student, amount: 300000, accountId: ids.cash, reference: null, paidOn: today }, today) as { receiptKey: string; opId: string };
    const [op] = db.waitingOps(10);
    const paymentId = id();
    db.completeOp(op, { paymentId, receiptId: id(), receiptNo: "00051", allocated: [{ chargeId: ids.april, amount: 300000 }] });

    expect(db.outboxCount()).toBe(0);
    expect(receipt(db, result.receiptKey)!.receiptNo).toBe("00051");
    expect(ledger(db, ids.student)!.outstanding).toBe(300000);

    // The pull brings the server's own allocation: it replaces the one written in, never adds to it.
    db.savePage("payments", { rows: [{ id: paymentId, studentId: ids.student, amount: 300000, paidOn: today }], cursor: null, serverTime: "2" });
    db.savePage("payment_allocations", { rows: [{ id: id(), paymentId, feeChargeId: ids.april, amount: 300000 }], cursor: null, serverTime: "2" });
    expect(ledger(db, ids.student)!.outstanding).toBe(300000);
    expect((db.db.prepare("select count(*) as n from payment_allocations").get() as { n: number }).n).toBe(1);
  });

  it("refuses a date to come and an amount of nothing", () => {
    expect(collect(db, { studentId: ids.student, amount: 0, accountId: null, reference: null, paidOn: today }, today)).toEqual({ ok: false, message: "badAmount" });
    expect(collect(db, { studentId: ids.student, amount: 100, accountId: null, reference: null, paidOn: "2026-12-01" }, today)).toEqual({ ok: false, message: "badDate" });
  });
});
