import { randomUUID } from "node:crypto";
import type { AdmissionFormSettings, AdmissionLetterView, AdmitClass, AdmitInput, AdmitResult, AdmitSetup, SaveResult, StudentDetails, StudentProfile } from "../shared/types";
import { admissionFieldErrors, formatPatterned, type AdmissionPattern } from "../shared/admission";
import type { LocalDb } from "./localdb";
import { school } from "./fees";

/**
 * Registration and students on the PC (Phase 5): the web's admission form
 * and student record (src/app/(app)/students in ilmways) from the offline
 * copy.
 *
 * A student admitted here gets ids made here, which the server keeps, so
 * the new student is on this PC's registers and fee screens at once and
 * whatever is done with them offline still points at them on the server.
 * The admission is one change in the outbox carrying the form's fields
 * under the web form's own names; the server runs the web's own action.
 */

const FORM = "admissionForm";

export function saveAdmissionForm(db: LocalDb, form: AdmissionFormSettings | null) {
  db.setMeta(FORM, form ? JSON.stringify(form) : null);
}

export function admissionForm(db: LocalDb): AdmissionFormSettings | null {
  const raw = db.getMeta(FORM);
  return raw ? (JSON.parse(raw) as AdmissionFormSettings) : null;
}

/* ------------------------------------------------------------------ */
/* Admission numbers (D9)                                              */
/* ------------------------------------------------------------------ */

export function admissionNosLeft(db: LocalDb): number {
  return (db.db.prepare("select ifnull(sum(last - next + 1), 0) as n from number_blocks where kind = 'admission' and next <= last").get() as { n: number }).n;
}

export function addAdmissionBlock(db: LocalDb, block: { id: string; prefix: string; first: number; last: number }) {
  db.db
    .prepare("insert or ignore into number_blocks (id, kind, prefix, first, last, next) values (?, 'admission', ?, ?, ?, ?)")
    .run(block.id, block.prefix, block.first, block.last, block.first);
}

function nextAdmission(db: LocalDb): { id: string; no: string } | null {
  const block = db.db
    .prepare("select id, prefix, next from number_blocks where kind = 'admission' and next <= last order by first limit 1")
    .get() as { id: string; prefix: string; next: number } | undefined;
  if (!block) return null;
  return { id: block.id, no: formatPatterned(JSON.parse(block.prefix) as AdmissionPattern, block.next) };
}

/* ------------------------------------------------------------------ */
/* Admitting                                                           */
/* ------------------------------------------------------------------ */

function admitClasses(db: LocalDb): { session: { id: string; name: string } | null; classes: AdmitClass[] } {
  const session = db.db.prepare("select id, name from academic_sessions where is_current = 1 and archived_at is null limit 1").get() as
    | { id: string; name: string }
    | undefined;
  if (!session) return { session: null, classes: [] };
  const rows = db.db
    .prepare(
      `select c.id as classId, c.name as className, s.id as sectionId, s.name as sectionName
       from classes c join sections s on s.class_id = c.id
       where c.session_id = ? and c.archived_at is null and s.archived_at is null
       order by c.level_order, c.name, s.name`,
    )
    .all(session.id) as { classId: string; className: string; sectionId: string; sectionName: string }[];
  const classes = new Map<string, AdmitClass>();
  for (const r of rows) {
    const k = classes.get(r.classId) ?? { id: r.classId, name: r.className, sections: [] };
    k.sections.push({ id: r.sectionId, name: r.sectionName });
    classes.set(r.classId, k);
  }
  return { session, classes: [...classes.values()] };
}

export function admitSetup(db: LocalDb, today: string): AdmitSetup {
  const { session, classes } = admitClasses(db);
  return { form: admissionForm(db), classes, session, today, nextAdmissionNo: nextAdmission(db)?.no ?? "", admissionNosLeft: admissionNosLeft(db) };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Saved here first, with ids made here, and sent at once when online (D8). */
export function admit(db: LocalDb, input: AdmitInput, today: string): AdmitResult & { opId?: string } {
  const fields = Object.fromEntries(Object.entries(input.fields ?? {}).filter(([k, v]) => typeof k === "string" && typeof v === "string").map(([k, v]) => [k, v.slice(0, 400_000)]));
  const { session, classes } = admitClasses(db);
  if (!session) return { ok: false, message: "noSession" };
  const klass = classes.find((k) => k.id === fields.classId);
  if (!klass) return { ok: false, message: "chooseClass", field: "classId" };
  if (!klass.sections.some((s) => s.id === fields.sectionId)) return { ok: false, message: "sectionRequired", field: "sectionId" };

  const form = admissionForm(db);
  const problem = admissionFieldErrors(form, klass.name, fields, today);
  if (problem) return { ok: false, ...problem };

  const typed = fields.admissionNo?.trim() ?? "";
  if (typed && db.db.prepare("select 1 from students where lower(admission_no) = lower(?)").get(typed)) {
    return { ok: false, message: "admissionNoTaken", field: "admissionNo" };
  }

  const studentId = randomUUID();
  const enrollmentId = randomUUID();
  const opId = randomUUID();
  const rollNo = fields.rollNo?.trim() ? Number(fields.rollNo) : null;
  const answers = Object.fromEntries(
    (form?.fields ?? [])
      .filter((f) => f.type !== "table" && fields[`x_${f.id}`])
      .map((f) => [f.id, { label: f.label, value: f.type === "checkbox" ? true : fields[`x_${f.id}`] }]),
  );

  db.db.transaction(() => {
    // The number this PC offered, kept: it is now this student's.
    const offered = nextAdmission(db);
    if (offered && typed === offered.no) db.db.prepare("update number_blocks set next = next + 1 where id = ?").run(offered.id);
    db.writeLocal("students", {
      id: studentId,
      admissionNo: typed,
      firstName: str(fields.firstName).trim(),
      lastName: str(fields.lastName).trim() || null,
      fatherName: str(fields.fatherName).trim() || null,
      dob: fields.dob || null,
      gender: fields.gender || null,
      bForm: fields.bForm || null,
      phone: fields.phone || null,
      email: fields.email || null,
      address: fields.address || null,
      admittedOn: fields.admittedOn,
      status: "active",
      admissionData: answers,
      __local: opId,
    });
    db.writeLocal("enrollments", {
      id: enrollmentId,
      studentId,
      sessionId: session.id,
      classId: klass.id,
      sectionId: fields.sectionId,
      rollNo: Number.isInteger(rollNo) ? rollNo : null,
      status: "active",
      enrolledOn: fields.admittedOn,
      __local: opId,
    });
    db.db
      .prepare("insert into outbox (op_id, action, payload, register_key, title, created_at) values (?, 'student.admit', ?, ?, ?, ?)")
      .run(
        opId,
        JSON.stringify({ studentId, enrollmentId, fields }),
        `student:${studentId}`,
        `${[fields.firstName, fields.lastName].filter(Boolean).join(" ")}${typed ? ` · ${typed}` : ""}`,
        new Date().toISOString(),
      );
  })();
  return { ok: true, studentId, opId };
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

type StudentRow = Record<string, unknown>;

function studentRow(db: LocalDb, studentId: string): StudentRow | null {
  const row = db.db.prepare("select data from students where id = ?").get(studentId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as StudentRow) : null;
}

const detailsOf = (row: StudentRow): StudentDetails => ({
  admissionNo: str(row.admissionNo),
  firstName: str(row.firstName),
  lastName: str(row.lastName),
  fatherName: str(row.fatherName),
  dob: str(row.dob),
  gender: str(row.gender),
  bForm: str(row.bForm),
  phone: str(row.phone),
  email: str(row.email),
  address: str(row.address),
  admittedOn: str(row.admittedOn),
});

function opsFor(db: LocalDb, studentId: string) {
  return db.db
    .prepare("select op_id, action, payload, status, message from outbox where register_key = ? order by seq")
    .all(`student:${studentId}`) as { op_id: string; action: string; payload: string; status: string; message: string | null }[];
}

function placeOf(db: LocalDb, studentId: string) {
  return db.db
    .prepare(
      `select c.name || ' — ' || sc.name as classLabel, c.name as className, se.name as sessionName
       from enrollments e join sections sc on sc.id = e.section_id join classes c on c.id = e.class_id
       join academic_sessions se on se.id = e.session_id
       where e.student_id = ? order by se.is_current desc, se.starts_on desc limit 1`,
    )
    .get(studentId) as { classLabel: string; className: string; sessionName: string } | undefined;
}

export function profile(db: LocalDb, studentId: string): StudentProfile | null {
  const row = studentRow(db, studentId);
  if (!row) return null;
  let details = detailsOf(row);
  const ops = opsFor(db, studentId);
  let issue: string | null = null;
  for (const op of ops) {
    if (op.action === "student.update") {
      const { studentId: _id, ...edited } = JSON.parse(op.payload) as StudentDetails & { studentId: string };
      void _id;
      details = { ...details, ...edited };
    }
    if (op.status === "issue") issue = op.message ?? "";
  }

  const guardians = db.db
    .prepare(
      `select json_extract(g.data, '$.name') as name, json_extract(g.data, '$.relation') as relation, json_extract(g.data, '$.phone') as phone
       from student_guardians sg join guardians g on g.id = json_extract(sg.data, '$.guardianId')
       where json_extract(sg.data, '$.studentId') = ?
       order by json_extract(sg.data, '$.isPrimary') desc`,
    )
    .all(studentId) as { name: string; relation: string | null; phone: string | null }[];
  // A student admitted here: their father is on the form until the server makes him a guardian.
  if (guardians.length === 0 && row.__local && details.fatherName) guardians.push({ name: details.fatherName, relation: "father", phone: null });

  const answers = Object.values((row.admissionData ?? {}) as Record<string, { label: string; value: unknown }>)
    .filter((a) => a && typeof a.label === "string" && (typeof a.value === "string" || typeof a.value === "boolean"))
    .map((a) => ({ label: a.label, value: typeof a.value === "boolean" ? (a.value ? "✓" : "—") : String(a.value) }));

  const place = placeOf(db, studentId);
  return {
    studentId,
    details,
    status: str(row.status) || "active",
    classLabel: place?.classLabel ?? null,
    sessionName: place?.sessionName ?? null,
    guardians,
    answers,
    waiting: ops.length > 0,
    issue,
    admittedHere: Boolean(row.__local),
  };
}

/**
 * Edit a student's details: the whole record, as the web's edit form sends
 * it (`student.update`). One waiting edit per student; a newer one replaces
 * it. For a student admitted here and not yet sent, the admission itself
 * carries the change.
 */
export function editStudent(db: LocalDb, studentId: string, details: StudentDetails): SaveResult {
  const row = studentRow(db, studentId);
  if (!row) return { ok: false, message: "stale" };
  if (!details.firstName.trim()) return { ok: false, message: "firstNameRequired" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(details.admittedOn)) return { ok: false, message: "badDate" };
  if (!details.admissionNo.trim()) return { ok: false, message: "admissionNoRequired" };
  const clash = db.db.prepare("select 1 from students where lower(admission_no) = lower(?) and id <> ?").get(details.admissionNo.trim(), studentId);
  if (clash) return { ok: false, message: "admissionNoTaken" };

  const clean = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 400)])) as StudentDetails;
  const admitOp = opsFor(db, studentId).find((op) => op.action === "student.admit");

  db.db.transaction(() => {
    if (admitOp) {
      const payload = JSON.parse(admitOp.payload) as { studentId: string; enrollmentId: string; fields: Record<string, string> };
      payload.fields = { ...payload.fields, ...clean };
      db.db.prepare("update outbox set payload = ?, status = 'waiting', message = null where op_id = ?").run(JSON.stringify(payload), admitOp.op_id);
      db.writeLocal("students", { ...row, ...clean, lastName: clean.lastName || null, fatherName: clean.fatherName || null });
      return;
    }
    db.db.prepare("delete from outbox where register_key = ? and action = 'student.update'").run(`student:${studentId}`);
    db.db
      .prepare("insert into outbox (op_id, action, payload, register_key, title, created_at) values (?, 'student.update', ?, ?, ?, ?)")
      .run(
        randomUUID(),
        JSON.stringify({ studentId, ...clean }),
        `student:${studentId}`,
        `${[clean.firstName, clean.lastName].filter(Boolean).join(" ")} · ${clean.admissionNo}`,
        new Date().toISOString(),
      );
  })();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The admission letter                                                */
/* ------------------------------------------------------------------ */

export function admissionLetter(db: LocalDb, studentId: string): AdmissionLetterView | null {
  const p = profile(db, studentId);
  if (!p) return null;
  const place = placeOf(db, studentId);
  const form = admissionForm(db);
  // Papers ticked on this PC's admission form; the server's record of them stays online.
  const admitOp = opsFor(db, studentId).find((op) => op.action === "student.admit");
  const ticked = admitOp ? (JSON.parse(admitOp.payload) as { fields: Record<string, string> }).fields : {};
  const documents = admitOp
    ? (form?.documents ?? []).filter((d) => d.enabled).map((d) => ({ label: d.label, received: ticked[`doc_${d.id}`] !== undefined }))
    : [];
  return {
    school: school(db),
    name: [p.details.firstName, p.details.lastName].filter(Boolean).join(" "),
    fatherName: p.details.fatherName || null,
    admissionNo: p.details.admissionNo,
    admittedOn: p.details.admittedOn,
    className: place?.className ?? null,
    sessionName: place?.sessionName ?? null,
    guardian: p.guardians[0]?.name ?? null,
    documents,
  };
}
