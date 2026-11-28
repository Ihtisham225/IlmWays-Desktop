import { describe, expect, it } from "vitest";
import { allocateOldestFirst, formatMoney, formatReceiptNo, toMinor } from "./fees";

describe("toMinor", () => {
  it("reads amounts as a cashier types them", () => {
    expect(toMinor("1,250", "PKR")).toBe(125000);
    expect(toMinor("1250.5", "PKR")).toBe(125050);
    expect(toMinor("2.125", "KWD")).toBe(2125);
  });
  it("refuses what isn't an amount above zero", () => {
    expect(toMinor("", "PKR")).toBeNull();
    expect(toMinor("0", "PKR")).toBeNull();
    expect(toMinor("-5", "PKR")).toBeNull();
    expect(toMinor("12.345", "PKR")).toBeNull();
    expect(toMinor("abc", "PKR")).toBeNull();
  });
});

describe("allocateOldestFirst", () => {
  const charges = [
    { id: "may", outstanding: 3000, dueDate: "2026-05-10" },
    { id: "apr", outstanding: 3000, dueDate: "2026-04-10" },
  ];
  it("pays the oldest charge first, as the server does", () => {
    expect(allocateOldestFirst(4000, charges)).toEqual({ allocations: [{ chargeId: "apr", amount: 3000 }, { chargeId: "may", amount: 1000 }], advance: 0 });
  });
  it("keeps what is over as an advance", () => {
    expect(allocateOldestFirst(7000, charges).advance).toBe(1000);
  });
});

describe("receipt numbers and money", () => {
  it("writes receipt numbers as the web does", () => {
    expect(formatReceiptNo("", 51)).toBe("00051");
    expect(formatReceiptNo("A", 7)).toBe("A-00007");
  });
  it("formats minor units", () => {
    expect(formatMoney(125000, "PKR")).toMatch(/1,250\.00/);
  });
});
