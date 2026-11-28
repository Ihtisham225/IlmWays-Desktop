import type { AdmissionField, AdmissionFormSettings, CoreKey } from "./types";

/**
 * The admission form's rules on the PC: which fields a class asks, and the
 * checks the web makes before saving (readAnswers and admitStudentAction in
 * ilmways). The server makes them all again; these only let the form say
 * what is missing without waiting for the internet.
 */

/** How a block of admission numbers is written (number-blocks.ts on the server). */
export type AdmissionPattern = { prefix: string; suffix: string; digits: number };
export const formatPatterned = (p: AdmissionPattern, n: number) => `${p.prefix}${String(n).padStart(p.digits, "0")}${p.suffix}`;

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The enabled fields asked for this class, in their stored order, as on the web. */
export function fieldsForClass(form: AdmissionFormSettings | null, className: string | null): AdmissionField[] {
  const name = className ? fold(className) : null;
  return (form?.fields ?? []).filter((f) => f.enabled && (f.classes.length === 0 || (name !== null && f.classes.some((c) => fold(c) === name))));
}

export const inputName = (id: string) => `x_${id}`;
export const cellName = (id: string, row: number, col: number) => `x_${id}__${row}_${col}`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (v: string) => ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The fixed fields a school can ask or require. */
export const CORE_REQUIRABLE: CoreKey[] = ["lastName", "fatherName", "dob", "gender", "bForm", "phone", "email", "address", "guardianCnic", "guardianPhone", "guardianEmail", "rollNo", "monthlyFee"];

/**
 * The first thing the form must fix before saving, or null. `message` is a
 * word of the window's (i18n), `field` the input it belongs to.
 */
export function admissionFieldErrors(
  form: AdmissionFormSettings | null,
  className: string,
  fields: Record<string, string>,
  today: string,
): { message: string; field: string } | null {
  const get = (name: string) => (fields[name] ?? "").trim();
  if (!get("firstName")) return { message: "fieldRequired", field: "firstName" };
  if (!realDate(get("admittedOn")) || get("admittedOn") > today) return { message: "badDate", field: "admittedOn" };
  if (get("dob") && (!realDate(get("dob")) || get("dob") > today)) return { message: "badDate", field: "dob" };
  if (get("rollNo") && !/^\d{1,5}$/.test(get("rollNo"))) return { message: "badRoll", field: "rollNo" };

  for (const key of CORE_REQUIRABLE) {
    const setting = form?.core[key];
    if (setting?.enabled && setting.required && !get(key)) return { message: "fieldRequired", field: key };
  }

  for (const f of fieldsForClass(form, className)) {
    const name = inputName(f.id);
    if (f.type === "checkbox") {
      if (f.required && !get(name)) return { message: "fieldRequired", field: name };
      continue;
    }
    if (f.type === "table") {
      const filled = f.rows.some((_, r) => f.columns.some((__, c) => c > 0 && get(cellName(f.id, r, c))));
      if (f.required && !filled) return { message: "fieldRequired", field: name };
      continue;
    }
    const value = get(name);
    if (!value) {
      if (f.required) return { message: "fieldRequired", field: name };
      continue;
    }
    if ((f.type === "select" || f.type === "radio") && !f.options.includes(value)) return { message: "fieldRequired", field: name };
    if (f.type === "date" && !realDate(value)) return { message: "badDate", field: name };
    if (f.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return { message: "badNumber", field: name };
    if (f.type === "cnic" && value.replace(/\D/g, "").length !== 13) return { message: "badCnic", field: name };
  }

  for (const d of form?.documents ?? []) {
    if (d.enabled && d.required && fields[`doc_${d.id}`] === undefined) return { message: "fieldRequired", field: `doc_${d.id}` };
  }
  return null;
}
