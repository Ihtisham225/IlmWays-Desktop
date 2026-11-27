/**
 * The attendance register's rules on the PC, kept free of Electron so they
 * can be tested plainly. They are the web's rules (markAttendanceAction in
 * the ilmways repo); the server checks them again when the register arrives.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** The PC's own calendar date. A register marked here is marked on this day. */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Why a register can't be changed, or null when it can. As on the web:
 * anyone who marks attendance may mark today; an earlier day needs the edit
 * permission, and no one marks a day still to come.
 */
export function registerBlock(
  date: string,
  today: string,
  permissions: { canMark: boolean; canEdit: boolean },
): null | "viewOnly" | "futureDate" | "needsEdit" {
  if (!permissions.canMark) return "viewOnly";
  if (date > today) return "futureDate";
  if (date < today && !permissions.canEdit) return "needsEdit";
  return null;
}

/** One register: a section on a day. The offline register is always the whole day's. */
export const registerKey = (sectionId: string, date: string) => `attendance:${sectionId}:${date}`;

/** What a saved register sends to the server (`attendance.mark` in the push handlers). */
export type AttendanceMarkPayload = {
  sectionId: string;
  date: string;
  period: null;
  /**
   * The day the PC saved it. A register saved on its own day counts as
   * marked on time even if it reaches the server days later; one saved on a
   * later day is an edit, and sends no "absent" message to parents (D7).
   */
  savedOn: string;
  entries: { enrollmentId: string; statusId: string }[];
};

/** At most this many students in one register; the server takes up to 500. */
export const REGISTER_MAX = 500;
