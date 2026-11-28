import { useState } from "react";
import type { SyncStatus } from "../../shared/types";
import { formatTime, type Locale, type T } from "../i18n";
import { Alert, Arrow, ClipboardCheck, CloudOff, Receipt, Spinner, UserPlus, Users } from "../icons";
import { SyncLine } from "./SyncLine";

/**
 * The offline work: what keeps going on this PC, and where its copy stands.
 * Shown when the internet drops, and from the bar at any time. Phase 3 has
 * attendance; fees, registration and marks join it in later phases.
 */
const ISSUE_LABEL: Record<string, "feeIssue" | "attendanceIssue" | "studentIssue" | "studentEditIssue"> = {
  "payment.record": "feeIssue",
  "attendance.mark": "attendanceIssue",
  "student.admit": "studentIssue",
  "student.update": "studentEditIssue",
};

export function Home({
  offline,
  lastContact,
  sync,
  canAttendance,
  canFees,
  canStudents,
  canAdmit,
  locale,
  t,
}: {
  offline: boolean;
  lastContact: string;
  sync: SyncStatus;
  canAttendance: boolean;
  canFees: boolean;
  canStudents: boolean;
  canAdmit: boolean;
  locale: Locale;
  t: T;
}) {
  const [retrying, setRetrying] = useState(false);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          {offline ? (
            <span className="flex size-9 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              <CloudOff className="size-5" />
            </span>
          ) : null}
          <h1 className="text-xl font-semibold">{offline ? t("offlineTitle") : t("offlineWork")}</h1>
        </div>
        <p className="text-sm text-muted">{offline ? t("offlineBody") : t("onlineHomeBody")}</p>
        {offline ? <p className="text-xs text-muted">{t("lastContact", { time: formatTime(lastContact, locale) })}</p> : null}
      </header>

      {canAttendance || canFees || canStudents || canAdmit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {canFees ? (
            <WorkCard icon={<Receipt className="size-5" />} title={t("feesCard")} body={t("feesCardBody")} disabled={!sync.firstSyncDone} onOpen={() => window.ilmways.setScreen("fees")} />
          ) : null}
          {canAttendance ? (
            <WorkCard icon={<ClipboardCheck className="size-5" />} title={t("attendanceCard")} body={t("attendanceCardBody")} disabled={!sync.firstSyncDone} onOpen={() => window.ilmways.setScreen("attendance")} />
          ) : null}
          {canAdmit ? (
            <WorkCard icon={<UserPlus className="size-5" />} title={t("admitCard")} body={t("admitCardBody")} disabled={!sync.firstSyncDone} onOpen={() => window.ilmways.setScreen("admit")} />
          ) : null}
          {canStudents ? (
            <WorkCard icon={<Users className="size-5" />} title={t("studentsCard")} body={t("studentsCardBody")} disabled={!sync.firstSyncDone} onOpen={() => window.ilmways.setScreen("students")} />
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-raised p-4 text-sm text-muted">{t("noOfflineWork")}</p>
      )}

      <section className="space-y-3 rounded-xl border border-line bg-raised p-4">
        <SyncLine sync={sync} offline={offline} locale={locale} t={t} />
        {!sync.firstSyncDone && !sync.running ? <p className="text-sm text-muted">{t("firstSyncNeeded")}</p> : null}
        {sync.waiting > 0 ? <p className="text-sm">{t("waitingCount", { count: sync.waiting })}</p> : null}
        {sync.error ? <p className="text-sm text-red-700 dark:text-red-400">{t("syncError", { message: sync.error })}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={sync.running || retrying}
            onClick={async () => {
              setRetrying(true);
              if (offline) await window.ilmways.retryConnection();
              await window.ilmways.syncNow();
              setRetrying(false);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-60"
          >
            {sync.running || retrying ? <Spinner className="size-3.5" /> : null}
            {offline ? t("tryAgain") : t("syncNow")}
          </button>
          {!offline ? (
            <button type="button" onClick={() => window.ilmways.setScreen(null)} className="rounded-md px-3 py-1.5 text-sm text-brand hover:underline">
              {t("backToWeb")}
            </button>
          ) : null}
        </div>
      </section>

      {sync.issues.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-500/30 dark:bg-red-500/10">
          <h2 className="flex items-center gap-2 font-medium text-red-800 dark:text-red-300">
            <Alert className="size-4" />
            {t("issuesTitle")}
          </h2>
          <p className="text-sm text-muted">{t("issuesBody")}</p>
          <ul className="divide-y divide-line">
            {sync.issues.map((issue) => (
              <li key={issue.opId} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t(ISSUE_LABEL[issue.action] ?? "attendanceIssue")} — {issue.title}
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-400">{issue.message}</p>
                </div>
                <button
                  type="button"
                  disabled={offline}
                  onClick={() => void window.ilmways.retryIssue(issue.opId)}
                  className="rounded-md border border-line bg-raised px-2.5 py-1 text-sm hover:bg-brand-soft disabled:opacity-60"
                >
                  {t("retry")}
                </button>
                <button type="button" onClick={() => void window.ilmways.discardIssue(issue.opId)} className="rounded-md px-2.5 py-1 text-sm text-red-700 hover:underline dark:text-red-400">
                  {t("discard")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-muted">{t("comingSoon")}</p>
    </div>
  );
}

function WorkCard({ icon, title, body, disabled, onOpen }: { icon: React.ReactNode; title: string; body: string; disabled: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="group flex w-full items-center gap-4 rounded-xl border border-line bg-raised p-4 text-start transition hover:border-brand/50 disabled:opacity-60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
      <Arrow className="size-4 text-muted transition group-hover:text-brand rtl:rotate-180" />
    </button>
  );
}
