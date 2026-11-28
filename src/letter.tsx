import { renderToStaticMarkup } from "react-dom/server";
import type { AdmissionLetterView } from "../shared/types";
import { directionOf, formatDay, type Locale, type T } from "./i18n";

/**
 * The admission letter, as the web prints it (src/components/admission-letter.tsx
 * in ilmways): the school, the admission confirmed, the papers received, and
 * a line for the parent to sign. A4, inline styles only, for the print window.
 */
export function AdmissionLetterDocument({ letter, locale, t }: { letter: AdmissionLetterView; locale: Locale; t: T }) {
  const s = letter.school;
  const counted = letter.documents;
  return (
    <div dir={directionOf(locale)} style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, 'Noto Nastaliq Urdu', 'Geeza Pro', sans-serif", color: "#111", fontSize: 13, lineHeight: 1.6, maxWidth: "170mm", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, borderBottom: "2px solid #111", paddingBottom: 10 }}>
        {s?.logo ? <img src={s.logo} alt="" style={{ height: 64, width: "auto", objectFit: "contain" }} /> : null}
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{s?.name ?? ""}</div>
          {s?.nameUr ? <div dir="rtl">{s.nameUr}</div> : null}
          {s?.address ? <div style={{ color: "#444", fontSize: 12 }}>{s.address}</div> : null}
          {s?.phone ? <div style={{ color: "#444", fontSize: 12 }}>{s.phone}</div> : null}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 12 }}>
        <span>
          {t("admissionNo")} <strong style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>{letter.admissionNo || "—"}</strong>
        </span>
        <span>{formatDay(letter.admittedOn, locale)}</span>
      </div>
      <h1 style={{ textAlign: "center", fontSize: 18, margin: "18px 0" }}>{t("letterTitle")}</h1>

      <p>{t("dear", { name: letter.guardian ?? t("parent") })}</p>
      <p style={{ marginTop: 12 }}>
        {t("letterBody", {
          name: letter.name,
          father: letter.fatherName ?? "—",
          className: letter.className ?? t("toBeAssigned"),
          session: letter.sessionName ?? "—",
          admittedOn: formatDay(letter.admittedOn, locale),
        })}
      </p>

      {counted.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600 }}>{t("documentsHeading", { received: counted.filter((d) => d.received).length, total: counted.length })}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginTop: 6, fontSize: 12 }}>
            {counted.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <span style={{ display: "inline-flex", width: 14, height: 14, border: "1px solid #111", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{d.received ? "✓" : ""}</span>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p style={{ marginTop: 18 }}>{t("letterClosing")}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 56, fontSize: 12 }}>
        <div style={{ borderTop: "1px solid #111", paddingTop: 4 }}>{t("parentSignature")}</div>
        <div style={{ borderTop: "1px solid #111", paddingTop: 4, textAlign: "end" }}>{t("principal")}</div>
      </div>
    </div>
  );
}

export function admissionLetterHtml(letter: AdmissionLetterView, locale: Locale, t: T): string {
  const body = renderToStaticMarkup(<AdmissionLetterDocument letter={letter} locale={locale} t={t} />);
  return `<!doctype html><html lang="${locale}" dir="${directionOf(locale)}"><head><meta charset="utf-8"><title>${t("letterTitle")}</title><style>@page { size: A4; margin: 18mm; } html,body{margin:0;background:#fff}</style></head><body>${body}</body></html>`;
}
