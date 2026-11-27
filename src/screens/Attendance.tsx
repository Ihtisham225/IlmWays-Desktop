import { useCallback, useEffect, useState } from "react";
import type { AttendanceSetup, Register, SyncStatus } from "../../shared/types";
import { registerBlock } from "../../shared/register";
import { isKey, type Locale, type T } from "../i18n";
import { ChevronLeft } from "../icons";
import { SyncLine } from "./SyncLine";

/**
 * The offline register: the web's attendance page (src/app/(app)/attendance
 * in ilmways) for the whole day, drawn from this PC's copy. A save goes to
 * the PC first and is sent at once when online (D8), so it is the same
 * screen with or without the internet.
 */

/** As on the web: a teacher reads green / red / amber / blue at a glance, whatever the theme. */
const EFFECT_STYLES: Record<string, string> = {
  present: "peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-checked:text-white",
  absent: "peer-checked:border-red-600 peer-checked:bg-red-600 peer-checked:text-white",
  leave: "peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-checked:text-amber-950",
  half: "peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white",
};

const LAST_SECTION = "attendance.section";

export function Attendance({ sync, offline, locale, t }: { sync: SyncStatus; offline: boolean; locale: Locale; t: T }) {
  const [setup, setSetup] = useState<AttendanceSetup | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SECTION);
    } catch {
      return null;
    }
  });
  const [date, setDate] = useState<string | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The setup and register follow the copy: reloaded whenever a sync brings something new.
  const syncMark = `${sync.lastSynced}:${sync.waiting}:${sync.issues.length}:${sync.running}`;
  useEffect(() => {
    void window.ilmways.attendanceSetup().then((next) => {
      setSetup(next);
      setDate((current) => current ?? next.today);
      setSectionId((current) => (current && next.sections.some((s) => s.id === current) ? current : null));
    });
  }, [syncMark]);

  const load = useCallback(async (section: string, day: string) => {
    const next = await window.ilmways.attendanceRegister(section, day);
    setRegister(next);
    setSelection(Object.fromEntries(next.entries.filter((e) => e.statusId).map((e) => [e.enrollmentId, e.statusId as string])));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!sectionId || !date) return setRegister(null);
    // Never under someone's hands: unsaved ticks stay until saved or the register changes.
    if (dirty && register?.sectionId === sectionId && register.date === date) return;
    void load(sectionId, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, date, syncMark, load]);

  if (!setup || !date) return null;

  const block = registerBlock(date, setup.today, setup);
  const statusLabel = (s: AttendanceSetup["statuses"][number]) => (locale === "ur" && s.labelUr ? s.labelUr : s.label);
  const present = setup.statuses.find((s) => s.effect === "present");
  const entries = register?.sectionId === sectionId && register.date === date ? register.entries : [];
  const marked = entries.filter((e) => selection[e.enrollmentId]).length;

  function choose(next: { section?: string; day?: string }) {
    setError(null);
    setJustSaved(false);
    setDirty(false);
    if (next.section !== undefined) {
      setSectionId(next.section);
      try {
        localStorage.setItem(LAST_SECTION, next.section);
      } catch {
        /* a remembered section is only a convenience */
      }
    }
    if (next.day !== undefined) setDate(next.day);
  }

  /** Always from the latest marks, so quick clicks never undo each other. */
  function mark(change: (current: Record<string, string>) => Record<string, string>) {
    setSelection(change);
    setDirty(true);
    setJustSaved(false);
    setError(null);
  }

  async function save() {
    if (!sectionId || saving) return;
    setSaving(true);
    setError(null);
    const result = await window.ilmways.saveRegister({
      sectionId,
      date: date!,
      entries: entries.filter((e) => selection[e.enrollmentId]).map((e) => ({ enrollmentId: e.enrollmentId, statusId: selection[e.enrollmentId] })),
    });
    setSaving(false);
    if (!result.ok) {
      setError(isKey(result.message) ? t(result.message) : result.message);
      if (result.message === "stale") await load(sectionId, date!);
      return;
    }
    setJustSaved(true);
    await load(sectionId, date!);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <button type="button" onClick={() => window.ilmways.setScreen("home")} className="-ms-1 flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t("offlineWork")}
          </button>
          <h1 className="text-xl font-semibold">{t("attendanceTitle")}</h1>
          {setup.session ? <p className="text-sm text-muted">{t("session", { name: setup.session.name })}</p> : null}
        </div>
        <SyncLine sync={sync} offline={offline} locale={locale} t={t} />
      </div>

      {!setup.session ? (
        <Notice>{t("noSession")}</Notice>
      ) : setup.sections.length === 0 ? (
        <Notice>{t("noSections")}</Notice>
      ) : (
        <section className="space-y-3 rounded-xl border border-line bg-raised p-4">
          <h2 className="text-sm font-medium">{t("section")}</h2>
          <ul className="flex flex-wrap gap-2">
            {setup.sections.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => choose({ section: option.id })}
                  className={`rounded-md border px-2.5 py-1.5 text-sm transition ${
                    option.id === sectionId ? "border-brand bg-brand-soft font-medium text-brand" : "border-line hover:bg-brand-soft/60"
                  }`}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
          {setup.canEdit ? (
            <label className="flex items-center gap-2 pt-1 text-sm">
              <span className="font-medium">{t("date")}</span>
              <input
                type="date"
                value={date}
                max={setup.today}
                onChange={(e) => e.target.value && choose({ day: e.target.value })}
                className="rounded-md border border-line bg-raised px-2 py-1 text-sm"
              />
            </label>
          ) : null}
        </section>
      )}

      {sectionId && setup.session ? (
        setup.statuses.length === 0 ? (
          <Notice>{t("noStatuses")}</Notice>
        ) : entries.length === 0 ? (
          <Notice>{t("noRoster", { date })}</Notice>
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted" aria-live="polite">
                {date} · {t("markedOf", { marked, total: entries.length })}
                {register?.waiting && !dirty ? (
                  <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">{t("notSentYet")}</span>
                ) : null}
              </p>
              {!block && present ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => mark(() => Object.fromEntries(entries.map((e) => [e.enrollmentId, present.id])))}
                    className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-brand-soft"
                  >
                    {t("allPresent")}
                  </button>
                  <button type="button" onClick={() => mark(() => ({}))} className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-brand-soft">
                    {t("clear")}
                  </button>
                </div>
              ) : null}
            </div>

            {register?.issue && !dirty ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {t("registerIssue", { message: register.issue })}
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-line bg-raised">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("roll")}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("student")}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.enrollmentId} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 tabular-nums text-muted">{entry.rollNo ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{entry.name}</span>
                        <span className="ms-2 font-mono text-xs text-muted">{entry.admissionNo}</span>
                      </td>
                      <td className="px-3 py-2">
                        {/* A radio group per student: tab between students, arrow keys within. */}
                        <fieldset className="flex flex-wrap gap-1" disabled={Boolean(block)}>
                          <legend className="sr-only">{t("statusFor", { name: entry.name })}</legend>
                          {setup.statuses.map((status) => (
                            <label key={status.id} className="cursor-pointer">
                              <input
                                type="radio"
                                name={`status_${entry.enrollmentId}`}
                                value={status.id}
                                checked={selection[entry.enrollmentId] === status.id}
                                onChange={() => mark((current) => ({ ...current, [entry.enrollmentId]: status.id }))}
                                className="peer sr-only"
                              />
                              <span
                                title={statusLabel(status)}
                                className={`inline-block min-w-9 rounded border border-line px-2 py-1 text-center text-xs font-medium transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${
                                  EFFECT_STYLES[status.effect] ?? "peer-checked:bg-ink peer-checked:text-raised"
                                }`}
                              >
                                {status.code}
                              </span>
                            </label>
                          ))}
                        </fieldset>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {block ? (
              <p className="text-sm text-amber-800 dark:text-amber-300">{t(block)}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || marked === 0 || (!dirty && !error && Boolean(register?.waiting || justSaved))}
                  className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? t("saving") : t("saveMarks", { count: marked })}
                </button>
                {error ? (
                  <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>
                ) : justSaved && !dirty ? (
                  <p role="status" className="text-sm text-brand">
                    {register?.issue ? null : offline && register?.waiting ? t("savedOffline") : register?.waiting ? t("savedSending") : t("saved")}
                  </p>
                ) : null}
              </div>
            )}
            {date < setup.today && !block ? <p className="text-xs text-muted">{t("lateNote")}</p> : null}

            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {setup.statuses.map((status) => (
                <div key={status.id} className="flex gap-1">
                  <dt className="font-mono font-medium">{status.code}</dt>
                  <dd>{statusLabel(status)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )
      ) : setup.session && setup.sections.length > 0 ? (
        <p className="text-sm text-muted">{t("chooseSection")}</p>
      ) : null}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{children}</p>;
}
