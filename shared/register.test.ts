import { describe, expect, it } from "vitest";
import { isDay, localDay, registerBlock, registerKey } from "./register";

describe("registerBlock", () => {
  const today = "2026-11-27";
  const teacher = { canMark: true, canEdit: false };
  const admin = { canMark: true, canEdit: true };

  it("lets anyone who marks attendance mark today", () => {
    expect(registerBlock(today, today, teacher)).toBeNull();
  });
  it("needs the edit permission for an earlier day, as on the web", () => {
    expect(registerBlock("2026-11-26", today, teacher)).toBe("needsEdit");
    expect(registerBlock("2026-11-26", today, admin)).toBeNull();
  });
  it("never marks a day still to come", () => {
    expect(registerBlock("2026-11-28", today, admin)).toBe("futureDate");
  });
  it("is view-only without the mark permission", () => {
    expect(registerBlock(today, today, { canMark: false, canEdit: true })).toBe("viewOnly");
  });
});

describe("localDay", () => {
  it("is the PC's calendar date, not UTC's", () => {
    // 1 a.m. on the 28th, local time: still the 27th in UTC west of Greenwich, but the 28th here.
    expect(localDay(new Date(2026, 10, 28, 1, 0))).toBe("2026-11-28");
  });
});

describe("isDay", () => {
  it("takes a plain date only", () => {
    expect(isDay("2026-11-27")).toBe(true);
    expect(isDay("2026-13-40")).toBe(false);
    expect(isDay("27/11/2026")).toBe(false);
    expect(isDay(null)).toBe(false);
  });
});

describe("registerKey", () => {
  it("is one register per section per day", () => {
    expect(registerKey("s1", "2026-11-27")).not.toBe(registerKey("s1", "2026-11-26"));
  });
});
