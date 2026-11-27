import { describe, expect, it } from "vitest";
import { contactExpired, linkTarget, serverUrl, signInPageMeaning } from "./rules";

const server = "https://www.ilmways.com";

describe("contactExpired", () => {
  const now = Date.parse("2026-11-27T10:00:00Z");
  it("keeps a PC signed in for 30 days without reaching the server", () => {
    expect(contactExpired("2026-10-29T10:00:00Z", now)).toBe(false);
  });
  it("signs it out after that", () => {
    expect(contactExpired("2026-10-27T09:00:00Z", now)).toBe(true);
  });
  it("treats an unreadable date as expired, never as forever", () => {
    expect(contactExpired("garbage", now)).toBe(true);
  });
});

describe("linkTarget", () => {
  it("keeps the school's pages in the window", () => {
    expect(linkTarget("https://www.ilmways.com/students?q=ali", server)).toBe("window");
  });
  it("sends other sites to the browser", () => {
    expect(linkTarget("https://wa.me/923001234567", server)).toBe("browser");
    expect(linkTarget("https://checkout.stripe.com/x", server)).toBe("browser");
    expect(linkTarget("https://demo.ilmways.com/", server)).toBe("browser");
    expect(linkTarget("mailto:office@school.pk", server)).toBe("browser");
  });
  it("ignores anything that isn't a web or mail link", () => {
    expect(linkTarget("file:///etc/passwd", server)).toBe("ignore");
    expect(linkTarget("javascript:alert(1)", server)).toBe("ignore");
    expect(linkTarget("not a url", server)).toBe("ignore");
  });
});

describe("signInPageMeaning", () => {
  it("tells a failed claim from signing out in the web app", () => {
    expect(signInPageMeaning("https://www.ilmways.com/login?desktop=expired", server)).toBe("claim-failed");
    expect(signInPageMeaning("https://www.ilmways.com/login", server)).toBe("signed-out");
  });
  it("ignores every other page", () => {
    expect(signInPageMeaning("https://www.ilmways.com/dashboard", server)).toBe("not-sign-in");
    expect(signInPageMeaning("https://evil.example/login", server)).toBe("not-sign-in");
  });
});

describe("serverUrl", () => {
  it("is production unless pointed elsewhere", () => {
    expect(serverUrl({})).toBe("https://www.ilmways.com");
    expect(serverUrl({ ILMWAYS_SERVER_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
});
