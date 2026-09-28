import { describe, expect, it } from "vitest";
import { formatLongDate, todayIso } from "./dates";

describe("todayIso", () => {
  it("usa la hora de Mazatlán (UTC-7), no la del servidor", () => {
    // 2026-09-29 05:30 UTC = 2026-09-28 22:30 en Mazatlán
    expect(todayIso(new Date("2026-09-29T05:30:00Z"))).toBe("2026-09-28");
    expect(todayIso(new Date("2026-09-29T07:30:00Z"))).toBe("2026-09-29");
  });
});

describe("formatLongDate", () => {
  it("formatea en español", () => {
    expect(formatLongDate("2026-09-28")).toBe("lunes, 28 de septiembre");
  });
});
