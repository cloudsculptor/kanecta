import { describe, it, expect } from "vitest";
import {
  parseNZDate,
  formatNZDate,
  formatNZTime,
  formatEventDate,
  formatNZDateTime,
  isoToNzInput,
} from "./dates";

// These formatters underpin every date shown in the app (events, notices,
// finances, discussions). Their output is behaviour that must NOT change across
// the Connector migration — pin it here.

describe("parseNZDate", () => {
  it("parses YYYY-MM-DD into a local Date with no timezone shift", () => {
    const d = parseNZDate("2026-05-28");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May is month index 4
    expect(d.getDate()).toBe(28);
  });

  it("uses only the date part of a full ISO string (no midnight-UTC roll-back)", () => {
    const d = parseNZDate("2026-01-01T23:59:59Z");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

describe("formatNZDate", () => {
  it("formats as '28 May 2026' by default", () => {
    expect(formatNZDate("2026-05-28")).toBe("28 May 2026");
  });

  it("respects custom Intl options", () => {
    expect(formatNZDate("2026-05-28", { day: "numeric", month: "long" })).toBe("28 May");
  });

  it("never shifts the day regardless of the stored value", () => {
    expect(formatNZDate("2026-01-01")).toBe("1 January 2026");
    expect(formatNZDate("2026-12-31")).toBe("31 December 2026");
  });
});

describe("formatNZTime", () => {
  it("formats an afternoon time as pm", () => {
    expect(formatNZTime("14:00:00")).toBe("2:00 pm");
  });

  it("formats a morning time as am with zero-padded minutes", () => {
    expect(formatNZTime("09:05:00")).toBe("9:05 am");
  });

  it("treats midnight as 12:xx am", () => {
    expect(formatNZTime("00:30:00")).toBe("12:30 am");
  });

  it("treats noon as 12:xx pm", () => {
    expect(formatNZTime("12:00:00")).toBe("12:00 pm");
  });

  it("accepts HH:MM without seconds", () => {
    expect(formatNZTime("17:45")).toBe("5:45 pm");
  });
});

describe("formatEventDate", () => {
  it("shows the date with a weekday prefix when there is no time", () => {
    expect(formatEventDate("2026-05-28", null)).toMatch(/^\w{3}, 28 May 2026$/);
  });

  it("appends the time after a middot when a time is given", () => {
    const result = formatEventDate("2026-05-28", "14:00:00");
    expect(result).toMatch(/^\w{3}, 28 May 2026 · 2:00 pm$/);
  });
});

describe("formatNZDateTime", () => {
  it("renders a timestamp in NZ time regardless of the host timezone", () => {
    // 02:00 UTC on 28 May 2026 is 14:00 NZST (UTC+12, no DST in May) — same day.
    const result = formatNZDateTime("2026-05-28T02:00:00Z");
    expect(result).toContain("2026");
    expect(result).toContain("May");
    expect(result).toContain("28");
  });

  it("keeps the NZ calendar day for a late-evening-UTC timestamp", () => {
    // 20:00 UTC on 28 May is 08:00 NZST on 29 May — the NZ day advances.
    const result = formatNZDateTime("2026-05-28T20:00:00Z");
    expect(result).toContain("29");
    expect(result).toContain("May");
  });
});

describe("isoToNzInput", () => {
  it("converts YYYY-MM-DD to DD/MM/YYYY", () => {
    expect(isoToNzInput("2026-05-28")).toBe("28/05/2026");
  });

  it("handles a full ISO datetime by taking the date part", () => {
    expect(isoToNzInput("2026-05-28T10:00:00Z")).toBe("28/05/2026");
  });

  it("returns an empty string for null, undefined or empty input", () => {
    expect(isoToNzInput(null)).toBe("");
    expect(isoToNzInput(undefined)).toBe("");
    expect(isoToNzInput("")).toBe("");
  });
});
