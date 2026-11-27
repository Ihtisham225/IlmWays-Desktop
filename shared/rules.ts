/**
 * The desktop's rules, kept free of Electron so they can be tested plainly.
 * See docs/DESKTOP-PLAN.md in the ilmways repo for the decisions behind them.
 */

/** D4: a PC that hasn't reached the server for this long must sign in again. */
export const OFFLINE_LIMIT_DAYS = 30;

/** Has this PC been out of touch too long to stay signed in? */
export function contactExpired(lastContact: string, now = Date.now()): boolean {
  const at = Date.parse(lastContact);
  if (Number.isNaN(at)) return true;
  return now - at > OFFLINE_LIMIT_DAYS * 86_400_000;
}

/**
 * Where a link in the web view goes. The school's own pages stay in the
 * window; anything else (WhatsApp, a payment page, a school's public
 * website) opens in the user's browser, where it belongs.
 */
export function linkTarget(url: string, server: string): "window" | "browser" | "ignore" {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "ignore";
  }
  if (target.protocol !== "http:" && target.protocol !== "https:" && target.protocol !== "mailto:" && target.protocol !== "tel:") {
    return "ignore";
  }
  if (target.protocol === "mailto:" || target.protocol === "tel:") return "browser";
  return target.origin === new URL(server).origin ? "window" : "browser";
}

/**
 * The web view reached the sign-in page. Either a claim code failed (the
 * URL says so, and the app should get a fresh one) or the person signed out
 * inside the web app, which signs this PC out: the desktop is the identity.
 */
export function signInPageMeaning(url: string, server: string): "not-sign-in" | "claim-failed" | "signed-out" {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "not-sign-in";
  }
  if (target.origin !== new URL(server).origin || target.pathname !== "/login") return "not-sign-in";
  return target.searchParams.get("desktop") === "expired" ? "claim-failed" : "signed-out";
}

/** The server the app talks to: production, unless a developer points it elsewhere. */
export function serverUrl(env: Record<string, string | undefined>): string {
  const raw = env.ILMWAYS_SERVER_URL?.trim();
  if (!raw) return "https://www.ilmways.com";
  const url = new URL(raw);
  return url.origin;
}
