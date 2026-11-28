import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalDb } from "./localdb";
import { addAdmissionBlock, admissionLetter, admissionNosLeft, admit, admitSetup, editStudent, profile, saveAdmissionForm } from "./students";
import { searchStudents } from "./fees";
import type { AdmissionFormSettings } from "../shared/types";

/**
 * Admitting and editing students on the PC, from a copy filled the way the
 * pull fills it.
 */
const id = () => randomUUID();
const today = "2026-11-28";
const ids = { session: id(), klass: id(), sectionA: id(), sectionB: id(), present: id() };

const core = Object.fromEntries(
  ["lastName", "bForm", "fatherName", "dob", "gender", "phone", "email", "address", "guardianCnic", "guardianPhone", "guardianEmail", "rollNo", "monthlyFee"].map((k) => [k, { enabled: true, required: false }]),
) as AdmissionFormSettings["core"];
const form: AdmissionFormSettings = {
  core: { ...core, fatherName: { enabled: true, required: true } },
  fields: [
    { id: "declaration", label: "I confirm the details are correct", type: "checkbox", section: "office", required: true, enabled: true, options: [], columns: [], rows: [], classes: [], hint: "" },
    { id: "religion", label: "Religion", type: "select", section: "student", required: false, enabled: true, options: ["Islam", "Other"], columns: [], rows: [], classes: [], hint: "" },
    { id: "hifz", label: "Hifz para", type: "number", section: "academic", required: true, enabled: true, options: [], columns: [], rows: [], classes: ["Hifz"], hint: "" },
  ],
  documents: [{ id: "bform", label: "B-Form copy", required: false, enabled: true }],
};

function filled() {
  const db = new LocalDb(":memory:");
  const page = (table: Parameters<LocalDb["savePage"]>[0], rows: Record<string, unknown>[]) => db.savePage(table, { rows, cursor: null, serverTime: "1" });
  page("academic_sessions", [{ id: ids.session, name: "2026-27", isCurrent: true, startsOn: "2026-04-01" }]);
  page("classes", [{ id: ids.klass, sessionId: ids.session, name: "Class 1", levelOrder: 1 }]);
  page("sections", [
    { id: ids.sectionA, classId: ids.klass, name: "A" },
    { id: ids.sectionB, classId: ids.klass, name: "B" },
  ]);
  page("students", [{ id: id(), admissionNo: "ADM-2026-0001", firstName: "Old", lastName: "Hand", status: "active", admittedOn: "2026-04-01" }]);
  page("attendance_statuses", [{ id: ids.present, code: "P", label: "Present", effect: "present" }]);
  saveAdmissionForm(db, form);
  return db;
}

const fields = (extra: Record<string, string> = {}) => ({
  classId: ids.klass,
  sectionId: ids.sectionA,
  admissionNo: "",
  admittedOn: today,
  firstName: "Amna",
  lastName: "Iqbal",
  fatherName: "Iqbal Khan",
  x_declaration: "on",
  ...extra,
});

describe("admitting on the PC", () => {
  let db: LocalDb;
  beforeEach(() => (db = filled()));

  it("offers the next number from this PC's block, in the school's format, and uses it up only when kept", () => {
    addAdmissionBlock(db, { id: id(), prefix: JSON.stringify({ prefix: "ADM-2026-", suffix: "", digits: 4 }), first: 42, last: 51 });
    const setup = admitSetup(db, today);
    expect(setup.nextAdmissionNo).toBe("ADM-2026-0042");
    expect(setup.classes).toEqual([{ id: ids.klass, name: "Class 1", sections: [{ id: ids.sectionA, name: "A" }, { id: ids.sectionB, name: "B" }] }]);

    expect(admit(db, { fields: fields({ admissionNo: "HAND-7" }) }, today).ok).toBe(true);
    expect(admissionNosLeft(db)).toBe(10);
    expect(admit(db, { fields: fields({ admissionNo: "ADM-2026-0042", firstName: "Second" }) }, today).ok).toBe(true);
    expect(admissionNosLeft(db)).toBe(9);
    expect(admitSetup(db, today).nextAdmissionNo).toBe("ADM-2026-0043");
  });

  it("puts the new student on this PC's registers and searches at once", () => {
    const result = admit(db, { fields: fields({ admissionNo: "ADM-2026-0042" }) }, today);
    expect(result.ok).toBe(true);
    expect(searchStudents(db, "amna")[0]).toMatchObject({ admissionNo: "ADM-2026-0042", classLabel: "Class 1 — A" });
    expect(db.register(ids.sectionA, today).entries.map((e) => e.name)).toEqual(["Amna Iqbal"]);

    const p = profile(db, (result as { studentId: string }).studentId)!;
    expect(p).toMatchObject({ admittedHere: true, waiting: true, classLabel: "Class 1 — A" });
    expect(p.guardians).toEqual([{ name: "Iqbal Khan", relation: "father", phone: null }]);
  });

  it("sends the form under the web form's own names, with the ids it made", () => {
    const result = admit(db, { fields: fields({ x_religion: "Islam", doc_bform: "on" }) }, today) as { studentId: string };
    const [op] = db.waitingOps(5);
    expect(op.action).toBe("student.admit");
    expect(op.payload).toMatchObject({ studentId: result.studentId, fields: { firstName: "Amna", x_religion: "Islam", doc_bform: "on", classId: ids.klass } });
    expect(admissionLetter(db, result.studentId)!.documents).toEqual([{ label: "B-Form copy", received: true }]);
  });

  it("says what the form still needs, as the web would", () => {
    expect(admit(db, { fields: fields({ fatherName: "" }) }, today)).toMatchObject({ ok: false, field: "fatherName" });
    expect(admit(db, { fields: fields({ x_declaration: "" }) }, today)).toMatchObject({ ok: false, field: "x_declaration" });
    expect(admit(db, { fields: fields({ x_religion: "Pagan" }) }, today)).toMatchObject({ ok: false, field: "x_religion" });
    expect(admit(db, { fields: fields({ sectionId: id() }) }, today)).toMatchObject({ ok: false, field: "sectionId" });
    expect(admit(db, { fields: fields({ admissionNo: "adm-2026-0001" }) }, today)).toMatchObject({ ok: false, field: "admissionNo" });
    // A field asked only for another class is not asked here.
    expect(admit(db, { fields: fields() }, today).ok).toBe(true);
  });

  it("takes the server's number when the PC had none, and drops a student the server refused when the change is discarded", () => {
    const result = admit(db, { fields: fields() }, today) as { studentId: string };
    const [op] = db.waitingOps(5);
    db.completeOp(op, { studentId: result.studentId, admissionNo: "ADM-2026-0099" });
    expect(profile(db, result.studentId)!.details.admissionNo).toBe("ADM-2026-0099");

    const refused = admit(db, { fields: fields({ firstName: "Refused" }) }, today) as { studentId: string };
    const [op2] = db.waitingOps(5);
    db.refuseOp(op2.opId, "Some answers need attention.");
    expect(profile(db, refused.studentId)!.issue).toMatch(/attention/);
    db.discardOp(op2.opId);
    expect(profile(db, refused.studentId)).toBeNull();
    expect(searchStudents(db, "refused")).toHaveLength(0);
  });
});

describe("editing a student on the PC", () => {
  let db: LocalDb;
  beforeEach(() => (db = filled()));
  const old = (db: LocalDb) => searchStudents(db, "old")[0].studentId;

  it("sends the whole record, newest edit only, and shows it at once", () => {
    const studentId = old(db);
    const base = profile(db, studentId)!.details;
    expect(editStudent(db, studentId, { ...base, phone: "0300-1111111" }).ok).toBe(true);
    expect(editStudent(db, studentId, { ...base, phone: "0300-2222222" }).ok).toBe(true);
    const ops = db.waitingOps(5);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ action: "student.update", payload: { studentId, phone: "0300-2222222", firstName: "Old" } });
    expect(profile(db, studentId)!.details.phone).toBe("0300-2222222");
  });

  it("folds an edit into an admission not sent yet", () => {
    const { studentId } = admit(db, { fields: fields() }, today) as { studentId: string };
    expect(editStudent(db, studentId, { ...profile(db, studentId)!.details, admissionNo: "NEW-1", lastName: "Khan" }).ok).toBe(true);
    const ops = db.waitingOps(5);
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toMatchObject({ fields: { lastName: "Khan", admissionNo: "NEW-1" } });
  });

  it("keeps admission numbers unique", () => {
    const { studentId } = admit(db, { fields: fields({ admissionNo: "ADM-2026-0005" }) }, today) as { studentId: string };
    expect(editStudent(db, studentId, { ...profile(db, studentId)!.details, admissionNo: "ADM-2026-0001" })).toEqual({ ok: false, message: "admissionNoTaken" });
  });
});
