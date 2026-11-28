import { renderToStaticMarkup } from "react-dom/server";
import type { ReceiptSize, ReceiptView } from "../shared/types";
import { formatMoney } from "../shared/fees";
import { directionOf, type Locale, type T } from "./i18n";

/**
 * A fee receipt as the web prints it (src/app/(app)/fees/receipts in
 * ilmways): the school, the receipt number, who paid, what it went
 * towards, and what is still outstanding. Drawn once, for the preview on
 * screen and for printing, on A4 or an 80 mm thermal roll. Inline styles
 * only: the print window loads this page alone, with no stylesheet.
 */
export function ReceiptDocument({ view, size, locale, t }: { view: ReceiptView; size: ReceiptSize; locale: Locale; t: T }) {
  const thermal = size === "thermal";
  const money = (minor: number) => formatMoney(minor, view.currency);
  const s = view.school;
  const row = { display: "flex", justifyContent: "space-between", gap: 8, padding: thermal ? "2px 0" : "3px 0" } as const;
  const muted = { color: "#555" } as const;

  return (
    <div
      dir={directionOf(locale)}
      style={{
        fontFamily: "'Segoe UI', system-ui, -apple-system, 'Noto Nastaliq Urdu', 'Geeza Pro', sans-serif",
        color: "#111",
        width: thermal ? "72mm" : "auto",
        maxWidth: thermal ? "72mm" : "150mm",
        margin: thermal ? "0 auto" : "0 auto",
        padding: thermal ? "4mm 2mm" : "10mm 0",
        fontSize: thermal ? 11 : 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ textAlign: "center" }}>
        {s?.logo ? <img src={s.logo} alt="" style={{ height: thermal ? 36 : 56, width: "auto", objectFit: "contain", marginBottom: 4 }} /> : null}
        <div style={{ fontSize: thermal ? 14 : 18, fontWeight: 600 }}>{s?.name ?? ""}</div>
        {s?.nameUr ? <div dir="rtl" style={muted}>{s.nameUr}</div> : null}
        {s?.address ? <div style={{ ...muted, fontSize: thermal ? 10 : 12 }}>{s.address}</div> : null}
        {s?.phone ? <div style={{ ...muted, fontSize: thermal ? 10 : 12 }}>{s.phone}</div> : null}
        <div style={{ marginTop: 6, fontWeight: 600, letterSpacing: 0.3 }}>{t("receiptTitle")}</div>
      </div>

      {view.cancelled ? (
        <div style={{ marginTop: 8, padding: 4, border: "1px solid #b91c1c", color: "#b91c1c", textAlign: "center", fontWeight: 600 }}>{t("cancelledReceipt")}</div>
      ) : null}

      <div style={{ marginTop: 10, borderTop: "1px dashed #999", borderBottom: "1px dashed #999", padding: "6px 0" }}>
        <div style={row}>
          <span style={muted}>{t("receiptNo")}</span>
          <strong style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>{view.receiptNo ?? "—"}</strong>
        </div>
        {view.receiptNo ? null : <div style={{ fontSize: thermal ? 9 : 11, color: "#92400e" }}>{t("provisional")}</div>}
        <div style={row}>
          <span style={muted}>{t("date")}</span>
          <span>{view.paidOn}</span>
        </div>
        <div style={row}>
          <span style={muted}>{t("student")}</span>
          <span>{view.student.name}</span>
        </div>
        <div style={row}>
          <span style={muted}>{t("admissionNo")}</span>
          <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>{view.student.admissionNo}</span>
        </div>
        {view.student.fatherName ? (
          <div style={row}>
            <span style={muted}>{t("fatherName")}</span>
            <span>{view.student.fatherName}</span>
          </div>
        ) : null}
        {view.student.classLabel ? (
          <div style={row}>
            <span style={muted}>{t("className")}</span>
            <span>{view.student.classLabel}</span>
          </div>
        ) : null}
        {view.account ? (
          <div style={row}>
            <span style={muted}>{t("method")}</span>
            <span>
              {view.account}
              {view.reference ? ` · ${view.reference}` : ""}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ ...row, fontWeight: 600, borderBottom: "1px solid #ccc" }}>
          <span>{t("towards")}</span>
          <span>{t("amount")}</span>
        </div>
        {view.lines.length === 0 ? <div style={{ ...muted, padding: "4px 0" }}>{t("advanceOnly")}</div> : null}
        {view.lines.map((line, index) => (
          <div key={index} style={row}>
            <span>
              {line.head} <span style={{ ...muted, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: thermal ? 9 : 11 }}>{line.period}</span>
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(line.amount)}</span>
          </div>
        ))}
        {view.lines.length > 0 && view.advance > 0 ? (
          <div style={row}>
            <span>{t("advance")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(view.advance)}</span>
          </div>
        ) : null}
        <div style={{ ...row, fontWeight: 700, borderTop: "1px solid #333", marginTop: 4, paddingTop: 4, fontSize: thermal ? 13 : 15 }}>
          <span>{t("total")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(view.total)}</span>
        </div>
        <div style={{ ...row, ...muted }}>
          <span>{t("balanceAfter")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(view.balance)}</span>
        </div>
      </div>
    </div>
  );
}

/** The receipt as a page of its own, for the print window. */
export function receiptHtml(view: ReceiptView, size: ReceiptSize, locale: Locale, t: T): string {
  const body = renderToStaticMarkup(<ReceiptDocument view={view} size={size} locale={locale} t={t} />);
  const page = size === "thermal" ? "@page { size: 80mm auto; margin: 0; }" : "@page { size: A4; margin: 12mm; }";
  return `<!doctype html><html lang="${locale}" dir="${directionOf(locale)}"><head><meta charset="utf-8"><title>${t("receiptTitle")}</title><style>${page} html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`;
}
