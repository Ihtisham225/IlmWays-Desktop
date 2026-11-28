import { useCallback, useEffect, useRef, useState } from "react";
import type { FeeSetup, Ledger, ReceiptSize, ReceiptView, StudentHit, SyncStatus } from "../../shared/types";
import { formatMoney, minorDigits, toMinor } from "../../shared/fees";
import { isKey, type Locale, type T } from "../i18n";
import { ChevronLeft } from "../icons";
import { ReceiptDocument, receiptHtml } from "../receipt";
import { SyncLine } from "./SyncLine";

/**
 * Fee collection on the PC: the web's collect screen
 * (src/app/(app)/fees/collect in ilmways) from the offline copy. Find the
 * student, see what is outstanding, collect, print the receipt on A4 or an
 * 80 mm roll. The same screen online or not; a payment is saved here first
 * and sent at once when online (D8).
 */
export function Fees({ sync, offline, locale, t }: { sync: SyncStatus; offline: boolean; locale: Locale; t: T }) {
  const [setup, setSetup] = useState<FeeSetup | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [receiptKey, setReceiptKey] = useState<string | null>(null);

  const syncMark = `${sync.lastSynced}:${sync.waiting}:${sync.issues.length}:${sync.running}`;
  useEffect(() => {
    void window.ilmways.feeSetup().then(setSetup);
  }, [syncMark]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits([]);
    const timer = setTimeout(() => void window.ilmways.searchStudents(q).then(setHits), 120);
    return () => clearTimeout(timer);
  }, [query, syncMark]);

  const loadLedger = useCallback(async (id: string) => setLedger(await window.ilmways.ledger(id)), []);
  useEffect(() => {
    if (studentId) void loadLedger(studentId);
    else setLedger(null);
  }, [studentId, syncMark, loadLedger]);

  if (!setup) return null;
  const money = (minor: number) => formatMoney(minor, setup.currency);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <button type="button" onClick={() => window.ilmways.setScreen("home")} className="-ms-1 flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t("offlineWork")}
          </button>
          <h1 className="text-xl font-semibold">{t("feesTitle")}</h1>
        </div>
        <SyncLine sync={sync} offline={offline} locale={locale} t={t} />
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
                  className={`w-full rounded-md border px-3 py-2 text-start text-sm transition ${
                    hit.studentId === studentId ? "border-brand bg-brand-soft" : "border-transparent hover:bg-brand-soft/60"
                  }`}
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

        {ledger ? (
          <StudentLedger ledger={ledger} setup={setup} money={money} t={t} onCollected={(key) => { setReceiptKey(key); void loadLedger(ledger.student.studentId); }} onReceipt={setReceiptKey} />
        ) : null}
      </div>

      {receiptKey ? <ReceiptDialog receiptKey={receiptKey} syncMark={syncMark} locale={locale} t={t} onClose={() => setReceiptKey(null)} /> : null}
    </div>
  );
}

function StudentLedger({
  ledger,
  setup,
  money,
  t,
  onCollected,
  onReceipt,
}: {
  ledger: Ledger;
  setup: FeeSetup;
  money: (minor: number) => string;
  t: T;
  onCollected: (receiptKey: string) => void;
  onReceipt: (key: string) => void;
}) {
  const open = ledger.charges.filter((c) => c.outstanding > 0 || c.waiting > 0);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-raised p-4">
        <div>
          <h2 className="text-lg font-semibold">{ledger.student.name}</h2>
          <p className="text-sm text-muted">
            <span className="font-mono">{ledger.student.admissionNo}</span>
            {ledger.student.fatherName ? ` · ${t("fatherName")}: ${ledger.student.fatherName}` : ""}
            {ledger.student.classLabel ? ` · ${ledger.student.classLabel}` : ""}
          </p>
        </div>
        <div className="text-end">
          <p className="text-xs text-muted">{t("outstanding")}</p>
          <p className="text-2xl font-semibold tabular-nums">{money(ledger.outstanding)}</p>
          {ledger.advance > 0 ? <p className="text-xs text-muted">{t("advance")}: {money(ledger.advance)}</p> : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-raised">
        {open.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t("nothingOutstanding")}</p>
        ) : (
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="px-3 py-2 text-start font-medium">{t("head")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("period")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("due")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("amount")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("paid")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("outstanding")}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((c) => (
                <tr key={c.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">{c.head}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{c.period}</td>
                  <td className="px-3 py-2 text-muted">{c.dueDate}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{money(c.net)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {money(c.paid + c.waiting)}
                    {c.waiting > 0 ? <span className="ms-1 text-xs text-amber-700 dark:text-amber-400">*</span> : null}
                  </td>
                  <td className="px-3 py-2 text-end font-medium tabular-nums">{money(c.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {setup.canCollect ? <CollectForm key={ledger.student.studentId} ledger={ledger} setup={setup} money={money} t={t} onCollected={onCollected} /> : null}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("paymentsTitle")}</h3>
        {ledger.payments.length === 0 ? (
          <p className="text-sm text-muted">{t("noPayments")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised">
            {ledger.payments.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="w-24 font-mono">{p.receiptNo ?? "—"}</span>
                <span className="text-muted">{p.paidOn}</span>
                <span className="flex-1 text-end font-medium tabular-nums">{money(p.amount)}</span>
                {p.state === "waiting" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">{t("notSent")}</span>
                ) : p.state === "issue" ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-500/15 dark:text-red-300">{t("refused")}</span>
                ) : p.cancelled ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-white/10">{t("cancelledReceipt")}</span>
                ) : null}
                <button type="button" onClick={() => onReceipt(p.key)} className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-brand-soft">
                  {t("viewReceipt")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CollectForm({ ledger, setup, money, t, onCollected }: { ledger: Ledger; setup: FeeSetup; money: (minor: number) => string; t: T; onCollected: (key: string) => void }) {
  const digits = minorDigits(setup.currency);
  const asMajor = (minor: number) => (minor / 10 ** digits).toFixed(digits).replace(/\.0+$/, "");
  const [amount, setAmount] = useState(ledger.outstanding > 0 ? asMajor(ledger.outstanding) : "");
  const [accountId, setAccountId] = useState(setup.accounts.find((a) => a.isDefault)?.id ?? setup.accounts[0]?.id ?? "");
  const [paidOn, setPaidOn] = useState(setup.today);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = toMinor(amount, setup.currency);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (minor === null) return setError(t("badAmount"));
    setSaving(true);
    setError(null);
    const result = await window.ilmways.collect({ studentId: ledger.student.studentId, amount: minor, accountId: accountId || null, reference: reference || null, paidOn });
    setSaving(false);
    if (!result.ok) return setError(isKey(result.message) ? t(result.message) : result.message);
    setReference("");
    onCollected(result.receiptKey);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-raised p-4">
      <h3 className="text-sm font-medium">{t("collectTitle")}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("amount")}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" required className="w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm tabular-nums" />
        </Field>
        <Field label={t("account")}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm">
            {setup.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("paidOn")}>
          <input type="date" value={paidOn} max={setup.today} onChange={(e) => setPaidOn(e.target.value)} className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm" />
        </Field>
        <Field label={t("reference")}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving || minor === null} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
          {saving ? t("collecting") : t("collectButton", { amount: minor ? money(minor) : "" })}
        </button>
        {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
        <p className={`text-xs ${setup.receiptsLeft === 0 ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}>
          {setup.receiptsLeft === 0 ? t("noReceiptsLeft") : t("receiptsLeft", { count: setup.receiptsLeft })}
        </p>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

/** The receipt on screen, with printing on A4 or an 80 mm roll. */
function ReceiptDialog({ receiptKey, syncMark, locale, t, onClose }: { receiptKey: string; syncMark: string; locale: Locale; t: T; onClose: () => void }) {
  const [view, setView] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void window.ilmways.receipt(receiptKey).then(setView);
  }, [receiptKey, syncMark]);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function print(size: ReceiptSize) {
    if (!view) return;
    setError(null);
    const result = await window.ilmways.printHtml(receiptHtml(view, size, locale, t), size);
    if (!result.ok) setError(t("printFailed", { message: result.message }));
  }

  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-line bg-raised shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-auto rounded-t-xl bg-white p-4">
          {view ? <ReceiptDocument view={view} size="a4" locale={locale} t={t} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <button type="button" disabled={!view} onClick={() => void print("a4")} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
            {t("printA4")}
          </button>
          <button type="button" disabled={!view} onClick={() => void print("thermal")} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50">
            {t("printThermal")}
          </button>
          {view?.waiting ? <span className="text-xs text-muted">{t("receiptWaitingNote")}</span> : null}
          <button ref={close} type="button" onClick={onClose} className="ms-auto rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink">
            {t("close")}
          </button>
        </div>
        {error ? <p role="alert" className="px-3 pb-3 text-sm text-red-700 dark:text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
