import { describe, expect, it } from "vitest";
import {
  type Schedule,
  addDays,
  describeSchedule,
  isOccurrence,
  nextOccurrence,
  occurrences,
  relativeDay,
} from "./recurrence";

const base = { endDate: null, day1: null, day2: null } as const;

describe("mensual", () => {
  it("día 31 cae en el último día de cada mes (febrero incluido, bisiesto)", () => {
    const s: Schedule = { ...base, frequency: "mensual", startDate: "2028-01-01", day1: 31 };
    expect(occurrences(s, "2028-01-01", "2028-04-30")).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
  });
  it("no genera antes del inicio ni después del fin", () => {
    const s: Schedule = { ...base, frequency: "mensual", startDate: "2026-09-01", endDate: "2026-11-30", day1: 5 };
    expect(occurrences(s, "2026-01-01", "2027-12-31")).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
  });
  it("cruza de año", () => {
    const s: Schedule = { ...base, frequency: "mensual", startDate: "2026-11-01", day1: 10 };
    expect(occurrences(s, "2026-12-01", "2027-01-31")).toEqual(["2026-12-10", "2027-01-10"]);
  });
});

describe("quincenal", () => {
  it("15 y último por defecto", () => {
    const s: Schedule = { ...base, frequency: "quincenal", startDate: "2026-02-01" };
    expect(occurrences(s, "2026-02-01", "2026-03-31")).toEqual(["2026-02-15", "2026-02-28", "2026-03-15", "2026-03-31"]);
  });
  it("días configurables (1 y 16)", () => {
    const s: Schedule = { ...base, frequency: "quincenal", startDate: "2026-09-01", day1: 1, day2: 16 };
    expect(occurrences(s, "2026-09-01", "2026-09-30")).toEqual(["2026-09-01", "2026-09-16"]);
  });
  it("si ambos días chocan en febrero no se duplica", () => {
    const s: Schedule = { ...base, frequency: "quincenal", startDate: "2026-02-01", day1: 30, day2: 31 };
    expect(occurrences(s, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
  });
});

describe("semanal y catorcenal", () => {
  it("cada 7 días desde la fecha ancla", () => {
    const s: Schedule = { ...base, frequency: "semanal", startDate: "2026-09-04" }; // viernes
    expect(occurrences(s, "2026-09-10", "2026-09-30")).toEqual(["2026-09-11", "2026-09-18", "2026-09-25"]);
  });
  it("catorcena respeta el ciclo aunque el rango empiece a la mitad", () => {
    const s: Schedule = { ...base, frequency: "catorcenal", startDate: "2026-09-04" };
    expect(occurrences(s, "2026-09-05", "2026-10-31")).toEqual(["2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30"]);
  });
});

describe("bimestral y anual", () => {
  it("bimestral desde la fecha ancla", () => {
    const s: Schedule = { ...base, frequency: "bimestral", startDate: "2026-08-20" };
    expect(occurrences(s, "2026-09-01", "2027-02-28")).toEqual(["2026-10-20", "2026-12-20", "2027-02-20"]);
  });
  it("anual con 29 de febrero se ajusta en años no bisiestos", () => {
    const s: Schedule = { ...base, frequency: "anual", startDate: "2028-02-29" };
    expect(occurrences(s, "2028-01-01", "2030-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });
  it("bimestral con día 31", () => {
    const s: Schedule = { ...base, frequency: "bimestral", startDate: "2026-12-31" };
    expect(occurrences(s, "2026-12-01", "2027-04-30")).toEqual(["2026-12-31", "2027-02-28", "2027-04-30"]);
  });
});

describe("una sola vez", () => {
  it("solo su fecha", () => {
    const s: Schedule = { ...base, frequency: "unica", startDate: "2026-10-03" };
    expect(occurrences(s, "2026-01-01", "2026-12-31")).toEqual(["2026-10-03"]);
    expect(occurrences(s, "2026-10-04", "2026-12-31")).toEqual([]);
    expect(nextOccurrence(s, "2026-10-04")).toBeNull();
  });
});

describe("utilidades", () => {
  it("siguiente ocurrencia e isOccurrence", () => {
    const s: Schedule = { ...base, frequency: "mensual", startDate: "2026-09-01", day1: 5 };
    expect(nextOccurrence(s, "2026-09-06")).toBe("2026-10-05");
    expect(isOccurrence(s, "2026-10-05")).toBe(true);
    expect(isOccurrence(s, "2026-10-06")).toBe(false);
  });
  it("textos amables", () => {
    expect(relativeDay("2026-09-28", "2026-09-28")).toBe("Hoy");
    expect(relativeDay("2026-09-29", "2026-09-28")).toBe("Mañana");
    expect(relativeDay("2026-10-01", "2026-09-28")).toBe("En 3 días");
    expect(relativeDay("2026-09-26", "2026-09-28")).toBe("Hace 2 días");
    expect(describeSchedule({ ...base, frequency: "mensual", startDate: "2026-09-01", day1: 31 })).toBe(
      "Cada mes, el último día",
    );
    expect(describeSchedule({ ...base, frequency: "quincenal", startDate: "2026-09-01" })).toBe(
      "Cada quincena: 15 y último",
    );
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
