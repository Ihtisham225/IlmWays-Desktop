import { useEffect, useMemo, useRef, useState } from "react";
import type { AdmissionField, AdmitSetup, CoreKey, FormSection, SyncStatus } from "../../shared/types";
import { cellName, fieldsForClass, inputName } from "../../shared/admission";
import { isKey, type Locale, type T } from "../i18n";
import { ChevronLeft } from "../icons";
import { admissionLetterHtml } from "../letter";
import { SyncLine } from "./SyncLine";

/**
 * The admission form on the PC: the web's (src/app/(app)/students/new and
 * src/components/admission-form-body.tsx in ilmways), drawn from the
 * school's own settings, with the same input names, so the server runs the
 * web's own admission on exactly what was typed here. Class first, then
 * the fields that class asks.
 */

const inputClass = "w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const SECTIONS: FormSection[] = ["program", "student", "family", "contact", "previous", "academic", "other", "office"];
/** A photo is kept small, as the web keeps it (about 220 KB as a data URL). */
const PHOTO_MAX_CHARS = 290_000;

export function Admit({ sync, offline, locale, t, onAdmitted }: { sync: SyncStatus; offline: boolean; locale: Locale; t: T; onAdmitted: (studentId: string) => void }) {
  const [setup, setSetup] = useState<AdmitSetup | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ studentId: string; name: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = () =>
    void window.ilmways.admitSetup().then((next) => {
      setSetup(next);
      if (next) setFields((f) => ({ admittedOn: next.today, admissionNo: next.nextAdmissionNo, ...(next.classes.length === 1 ? { classId: next.classes[0].id } : {}), ...f }));
    });
  useEffect(load, []);

  const klass = setup?.classes.find((k) => k.id === fields.classId) ?? null;
  const custom = useMemo(() => (setup && klass ? fieldsForClass(setup.form, klass.name) : []), [setup, klass]);
  useEffect(() => {
    // One section: chosen for them, as on the web.
    if (klass && klass.sections.length === 1 && fields.sectionId !== klass.sections[0].id) setFields((f) => ({ ...f, sectionId: klass.sections[0].id }));
  }, [klass, fields.sectionId]);

  if (!setup) return null;
  const core = setup.form?.core;
  const set = (name: string, value: string | null) =>
    setFields((f) => {
      const next = { ...f };
      if (value === null) delete next[name];
      else next[name] = value;
      return next;
    });
  const on = (key: CoreKey) => core?.[key]?.enabled ?? true;
  const required = (key: CoreKey) => Boolean(core?.[key]?.enabled && core[key].required);
  const label = (key: CoreKey, fallback: string) => core?.[key]?.label || fallback;
  const fieldError = (name: string) => (error?.field === name ? (isKey(error.message) ? t(error.message) : error.message) : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const sent = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== "" || k === "admissionNo"));
    const result = await window.ilmways.admit({ fields: sent });
    setSaving(false);
    if (!result.ok) {
      setError({ message: result.message, field: result.field });
      // Show the field that needs attention.
      if (result.field) formRef.current?.querySelector<HTMLElement>(`[name="${result.field}"]`)?.focus();
      return;
    }
    setDone({ studentId: result.studentId, name: [fields.firstName, fields.lastName].filter(Boolean).join(" ") });
  }

  async function printLetter(studentId: string) {
    const letter = await window.ilmways.admissionLetter(studentId);
    if (letter) await window.ilmways.printHtml(admissionLetterHtml(letter, locale, t), "a4");
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <button type="button" onClick={() => window.ilmways.setScreen("students")} className="-ms-1 flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("studentsTitle")}
        </button>
        <h1 className="text-xl font-semibold">{t("admitTitle")}</h1>
      </div>
      <SyncLine sync={sync} offline={offline} locale={locale} t={t} />
    </div>
  );

  if (done) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-6">
        {header}
        <div className="space-y-4 rounded-xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-sm">{t("admittedNote", { name: done.name })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void printLetter(done.studentId)} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-110">
              {t("printLetter")}
            </button>
            <button type="button" onClick={() => onAdmitted(done.studentId)} className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm hover:bg-brand-soft">
              {t("openRecord")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDone(null);
                setFields({});
                load();
              }}
              className="rounded-md px-3 py-1.5 text-sm text-brand hover:underline"
            >
              {t("admitAnother")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const text = (name: CoreKey | "firstName" | "admittedOn" | "admissionNo", caption: string, opts: { type?: string; required?: boolean; wide?: boolean; hint?: string; max?: string } = {}) => (
    <Field key={name} label={caption} required={opts.required} error={fieldError(name)} wide={opts.wide} hint={opts.hint}>
      <input
        name={name}
        type={opts.type ?? "text"}
        max={opts.max}
        value={fields[name] ?? ""}
        onChange={(e) => set(name, e.target.value)}
        required={opts.required}
        dir={opts.type === "email" || opts.type === "tel" || name === "admissionNo" ? "ltr" : undefined}
        className={inputClass}
      />
    </Field>
  );
  const optional = (key: CoreKey, caption: string, opts: { type?: string; wide?: boolean; max?: string } = {}) => (on(key) ? text(key, label(key, caption), { ...opts, required: required(key) }) : null);
  const customIn = (section: FormSection) => custom.filter((f) => f.section === section).map((f) => <CustomField key={f.id} field={f} fields={fields} set={set} error={fieldError(inputName(f.id))} />);

  const blocks: Record<FormSection, React.ReactNode[]> = {
    program: customIn("program"),
    student: [
      <PhotoField key="photo" value={fields.photo ?? ""} onChange={(v) => set("photo", v)} t={t} />,
      text("admissionNo", t("admissionNo"), { hint: setup.nextAdmissionNo ? t("nextFromBlock") : t("noAdmissionNos") }),
      text("admittedOn", t("admissionDate"), { type: "date", required: true, max: setup.today }),
      text("firstName", t("firstName"), { required: true }),
      optional("lastName", t("lastName")),
      optional("bForm", t("bForm")),
      optional("dob", t("dob"), { type: "date", max: setup.today }),
      on("gender") ? (
        <Field key="gender" label={label("gender", t("gender"))} required={required("gender")} error={fieldError("gender")}>
          <select name="gender" value={fields.gender ?? ""} onChange={(e) => set("gender", e.target.value)} className={inputClass}>
            <option value="">{t("genderNone")}</option>
            <option value="male">{t("genderMale")}</option>
            <option value="female">{t("genderFemale")}</option>
            <option value="other">{t("genderOther")}</option>
          </select>
        </Field>
      ) : null,
      optional("phone", t("studentPhone"), { type: "tel" }),
      optional("email", t("studentEmail"), { type: "email" }),
      ...customIn("student"),
    ],
    family: [optional("fatherName", t("fatherName")), optional("guardianCnic", t("guardianCnic")), optional("guardianPhone", t("guardianPhone"), { type: "tel" }), optional("guardianEmail", t("guardianEmail"), { type: "email" }), ...customIn("family")],
    contact: [optional("address", t("address"), { wide: true }), ...customIn("contact")],
    previous: customIn("previous"),
    academic: customIn("academic"),
    other: [on("monthlyFee") ? text("monthlyFee", label("monthlyFee", t("monthlyFee")), { required: required("monthlyFee") }) : null, ...customIn("other")],
    office: customIn("office"),
  };
  const documents = (setup.form?.documents ?? []).filter((d) => d.enabled);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6">
      {header}
      {!setup.session ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{t("noSession")}</p>
      ) : (
        <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate>
          <fieldset className="rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
            <legend className="px-1 text-sm font-semibold">{t("classStep")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("className")} required error={fieldError("classId")}>
                <select name="classId" value={fields.classId ?? ""} onChange={(e) => setFields((f) => ({ ...f, classId: e.target.value, sectionId: "" }))} className={inputClass}>
                  <option value="">{t("chooseClassOption")}</option>
                  {setup.classes.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </Field>
              {klass && klass.sections.length > 1 ? (
                <Field label={t("section")} required error={fieldError("sectionId")}>
                  <select name="sectionId" value={fields.sectionId ?? ""} onChange={(e) => set("sectionId", e.target.value)} className={inputClass}>
                    <option value="">{t("chooseSectionOption")}</option>
                    {klass.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {klass && on("rollNo") ? text("rollNo", label("rollNo", t("rollNo")), { required: required("rollNo") }) : null}
            </div>
          </fieldset>

          {klass
            ? SECTIONS.map((section) => {
                const items = blocks[section].filter(Boolean);
                return items.length ? (
                  <fieldset key={section} className="rounded-xl border border-line bg-raised p-4">
                    <legend className="px-1 text-sm font-semibold">{t(`section_${section}`)}</legend>
                    <div className="grid gap-3 sm:grid-cols-2">{items}</div>
                  </fieldset>
                ) : null;
              })
            : null}

          {klass && documents.length ? (
            <fieldset className="rounded-xl border border-line bg-raised p-4">
              <legend className="px-1 text-sm font-semibold">{t("documentsTitle")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {documents.map((d) => (
                  <label key={d.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name={`doc_${d.id}`} checked={fields[`doc_${d.id}`] !== undefined} onChange={(e) => set(`doc_${d.id}`, e.target.checked ? "on" : null)} className="mt-0.5 size-4" />
                    <span>
                      {d.label}
                      {d.required ? <span className="ms-0.5 text-red-600">*</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              {error?.field?.startsWith("doc_") ? <p className="mt-2 text-xs text-red-600">{t("fieldRequired")}</p> : null}
            </fieldset>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving || !klass} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
              {saving ? t("admitting") : t("admitButton")}
            </button>
            {error ? (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error.field ? t("formHasErrors") : isKey(error.message) ? t(error.message) : error.message}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, required, error, wide, hint, children }: { label: string; required?: boolean; error?: string | null; wide?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="font-medium">
        {label}
        {required ? <span className="ms-0.5 text-red-600">*</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** One of the school's own fields, drawn by its type as the web draws it. */
function CustomField({ field: f, fields, set, error }: { field: AdmissionField; fields: Record<string, string>; set: (name: string, value: string | null) => void; error: string | null }) {
  const name = inputName(f.id);
  const value = fields[name] ?? "";
  if (f.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name={name} checked={Boolean(value)} onChange={(e) => set(name, e.target.checked ? "on" : null)} className="mt-0.5 size-4" />
        <span>
          {f.label}
          {f.required ? <span className="ms-0.5 text-red-600">*</span> : null}
          {error ? <span className="block text-xs text-red-600">{error}</span> : null}
        </span>
      </label>
    );
  }
  if (f.type === "table") {
    return (
      <Field label={f.label} required={f.required} error={error} wide hint={f.hint}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {f.columns.map((c, i) => (
                <th key={i} className="border border-line px-2 py-1 text-start font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {f.rows.map((rowLabel, r) => (
              <tr key={r}>
                {f.columns.map((_, c) => {
                  const cell = cellName(f.id, r, c);
                  return (
                    <td key={c} className="border border-line p-0">
                      {c === 0 && rowLabel ? (
                        <span className="block px-2 py-1">{rowLabel}</span>
                      ) : (
                        <input name={cell} value={fields[cell] ?? ""} onChange={(e) => set(cell, e.target.value)} className="w-full bg-transparent px-2 py-1 outline-none" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Field>
    );
  }
  if (f.type === "radio") {
    return (
      <Field label={f.label} required={f.required} error={error} hint={f.hint}>
        <span className="flex flex-wrap gap-3">
          {f.options.map((o) => (
            <label key={o} className="flex items-center gap-1.5">
              <input type="radio" name={name} checked={value === o} onChange={() => set(name, o)} />
              {o}
            </label>
          ))}
        </span>
      </Field>
    );
  }
  return (
    <Field label={f.label} required={f.required} error={error} wide={f.type === "textarea"} hint={f.hint}>
      {f.type === "select" ? (
        <select name={name} value={value} onChange={(e) => set(name, e.target.value)} className={inputClass}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea name={name} value={value} onChange={(e) => set(name, e.target.value)} rows={3} className={inputClass} />
      ) : (
        <input
          name={name}
          value={value}
          onChange={(e) => set(name, e.target.value)}
          type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
          inputMode={f.type === "number" || f.type === "cnic" ? "numeric" : undefined}
          className={inputClass}
        />
      )}
    </Field>
  );
}

/** The student's photo, made small enough to send with the form (as the web's photo field does). */
function PhotoField({ value, onChange, t }: { value: string; onChange: (dataUrl: string | null) => void; t: T }) {
  const [problem, setProblem] = useState(false);
  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(false);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return setProblem(true);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    if (url.length > PHOTO_MAX_CHARS) return setProblem(true);
    onChange(url);
  }
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      {value ? <img src={value} alt="" className="size-16 rounded-md object-cover" /> : <span className="size-16 rounded-md border border-dashed border-line" />}
      <label className="cursor-pointer rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-brand-soft">
        {t("choosePhoto")}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      {value ? (
        <button type="button" onClick={() => onChange(null)} className="text-sm text-muted hover:text-ink">
          {t("removePhoto")}
        </button>
      ) : null}
      {problem ? <span className="text-xs text-red-600">{t("photoTooLarge")}</span> : null}
    </div>
  );
}
