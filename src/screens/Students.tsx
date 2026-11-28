import { useEffect, useState } from "react";
import type { StudentDetails, StudentHit, StudentProfile, SyncStatus } from "../../shared/types";
import { isKey, type Locale, type T } from "../i18n";
import { ChevronLeft } from "../icons";
import { admissionLetterHtml } from "../letter";
import { SyncLine } from "./SyncLine";

/**
 * Students on the PC: search, the record, and editing a student's own
 * details as the web's edit form does (the whole record, `student.update`).
 * Guardians and the school's own answers are shown as they are; changing
 * them stays on IlmWays online.
 */
export function Students({
  sync,
  offline,
  locale,
  t,
  canAdmit,
  canEdit,
  openId,
}: {
  sync: SyncStatus;
  offline: boolean;
  locale: Locale;
  t: T;
  canAdmit: boolean;
  canEdit: boolean;
  /** A student to open straight away (one just admitted). */
  openId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [studentId, setStudentId] = useState<string | null>(openId);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const syncMark = `${sync.lastSynced}:${sync.waiting}:${sync.issues.length}:${sync.running}`;

  useEffect(() => setStudentId(openId), [openId]);
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits([]);
    const timer = setTimeout(() => void window.ilmways.searchStudents(q).then(setHits), 120);
    return () => clearTimeout(timer);
  }, [query, syncMark]);
  useEffect(() => {
    if (studentId) void window.ilmways.studentProfile(studentId).then(setStudent);
    else setStudent(null);
  }, [studentId, syncMark]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <button type="button" onClick={() => window.ilmways.setScreen("home")} className="-ms-1 flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t("offlineWork")}
          </button>
          <h1 className="text-xl font-semibold">{t("studentsTitle")}</h1>
        </div>
        <div className="flex items-center gap-3">
          <SyncLine sync={sync} offline={offline} locale={locale} t={t} />
          {canAdmit ? (
            <button type="button" onClick={() => window.ilmways.setScreen("admit")} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-110">
              {t("newAdmission")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <section className="space-y-2">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchStudents")}
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {query.trim() && hits.length === 0 ? <p className="px-1 text-sm text-muted">{t("noStudentsFound")}</p> : null}
          <ul className="max-h-[60vh] space-y-1 overflow-auto">
            {hits.map((hit) => (
              <li key={hit.studentId}>
                <button
                  type="button"
                  onClick={() => setStudentId(hit.studentId)}
                  className={`w-full rounded-md border px-3 py-2 text-start text-sm transition ${hit.studentId === studentId ? "border-brand bg-brand-soft" : "border-transparent hover:bg-brand-soft/60"}`}
                >
                  <span className="block font-medium">{hit.name}</span>
                  <span className="block text-xs text-muted">
                    <span className="font-mono">{hit.admissionNo}</span>
                    {hit.fatherName ? ` · ${hit.fatherName}` : ""}
                    {hit.classLabel ? ` · ${hit.classLabel}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {student ? <Record key={student.studentId} student={student} canEdit={canEdit} locale={locale} t={t} /> : null}
      </div>
    </div>
  );
}

function Record({ student, canEdit, locale, t }: { student: StudentProfile; canEdit: boolean; locale: Locale; t: T }) {
  const [editing, setEditing] = useState(false);
  const d = student.details;
  const rows: [string, string][] = [
    [t("admissionNo"), d.admissionNo],
    [t("admissionDate"), d.admittedOn],
    [t("fatherName"), d.fatherName],
    [t("dob"), d.dob],
    [t("gender"), d.gender ? t(d.gender === "male" ? "genderMale" : d.gender === "female" ? "genderFemale" : "genderOther") : ""],
    [t("bForm"), d.bForm],
    [t("studentPhone"), d.phone],
    [t("studentEmail"), d.email],
    [t("address"), d.address],
  ];

  async function printLetter() {
    const letter = await window.ilmways.admissionLetter(student.studentId);
    if (letter) await window.ilmways.printHtml(admissionLetterHtml(letter, locale, t), "a4");
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-raised p-4">
        <div>
          <h2 className="text-lg font-semibold">{[d.firstName, d.lastName].filter(Boolean).join(" ")}</h2>
          <p className="text-sm text-muted">
            <span className="font-mono">{d.admissionNo || "—"}</span>
            {student.classLabel ? ` · ${student.classLabel}` : ""}
            {student.sessionName ? ` · ${student.sessionName}` : ""}
          </p>
          {student.admittedHere ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("admittedHereNote")}</p> : student.waiting ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("notSentYet")}</p> : null}
          {student.issue ? <p className="mt-1 text-xs text-red-700 dark:text-red-400">{student.issue}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void printLetter()} className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-brand-soft">
            {t("printLetter")}
          </button>
          {canEdit && !editing ? (
            <button type="button" onClick={() => setEditing(true)} className="rounded-md bg-brand px-2.5 py-1.5 text-sm font-medium text-white hover:brightness-110">
              {t("editDetails")}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <EditForm studentId={student.studentId} initial={d} t={t} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-raised p-4 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-line/50 py-1">
              <dt className="text-muted">{label}</dt>
              <dd className="text-end">{value || t("notOnRecord")}</dd>
            </div>
          ))}
        </dl>
      )}

      {student.guardians.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("guardiansTitle")}</h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised text-sm">
            {student.guardians.map((g, i) => (
              <li key={i} className="flex flex-wrap gap-3 px-3 py-2">
                <span className="font-medium">{g.name}</span>
                {g.relation ? <span className="text-muted">{g.relation}</span> : null}
                {g.phone ? <span className="ms-auto font-mono text-muted" dir="ltr">{g.phone}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {student.answers.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("answersTitle")}</h3>
          <dl className="grid gap-x-6 gap-y-1 rounded-xl border border-line bg-raised p-4 text-sm sm:grid-cols-2">
            {student.answers.map((a, i) => (
              <div key={i} className="flex justify-between gap-3 py-0.5">
                <dt className="text-muted">{a.label}</dt>
                <dd className="text-end">{a.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function EditForm({ studentId, initial, t, onDone }: { studentId: string; initial: StudentDetails; t: T; onDone: () => void }) {
  const [details, setDetails] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof StudentDetails, label: string, type = "text") => (
    <label key={key} className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type={type}
        value={details[key]}
        onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
        dir={type === "email" || type === "tel" || key === "admissionNo" ? "ltr" : undefined}
        className="w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm"
      />
    </label>
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await window.ilmways.editStudent(studentId, details);
    setSaving(false);
    if (!result.ok) return setError(isKey(result.message) ? t(result.message) : result.message);
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-raised p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("admissionNo", t("admissionNo"))}
        {field("admittedOn", t("admissionDate"), "date")}
        {field("firstName", t("firstName"))}
        {field("lastName", t("lastName"))}
        {field("fatherName", t("fatherName"))}
        {field("dob", t("dob"), "date")}
        <label className="block space-y-1 text-sm">
          <span className="text-muted">{t("gender")}</span>
          <select value={details.gender} onChange={(e) => setDetails((d) => ({ ...d, gender: e.target.value }))} className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm">
            <option value="">{t("genderNone")}</option>
            <option value="male">{t("genderMale")}</option>
            <option value="female">{t("genderFemale")}</option>
            <option value="other">{t("genderOther")}</option>
          </select>
        </label>
        {field("bForm", t("bForm"))}
        {field("phone", t("studentPhone"), "tel")}
        {field("email", t("studentEmail"), "email")}
        {field("address", t("address"))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
          {saving ? t("collecting") : t("saveDetails")}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink">
          {t("cancel")}
        </button>
        {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
      </div>
    </form>
  );
}
