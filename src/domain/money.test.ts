import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyShort, mulRound, parseMoney, splitEvenly, sumCents } from "./money";

describe("formatMoney", () => {
  it("formatea pesos mexicanos con comas y 2 decimales", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(100000000)).toBe("$1,000,000.00");
  });
  it("negativos con signo al frente", () => {
    expect(formatMoney(-230000)).toBe("-$2,300.00");
  });
  it("versión corta quita .00", () => {
    expect(formatMoneyShort(150000)).toBe("$1,500");
    expect(formatMoneyShort(150050)).toBe("$1,500.50");
  });
  it("rechaza montos no enteros", () => {
    expect(() => formatMoney(1.5)).toThrow();
  });
});

describe("parseMoney", () => {
  it.each([
    ["1234", 123400],
    ["1,234.5", 123450],
    ["$1,234.56", 123456],
    [" 45.3 ", 4530],
    ["0.07", 7],
    ["10.", 1000],
  ])("%s → %d centavos", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });
  it.each(["", "abc", "-5", "1.234", "1.2.3", "$"])("rechaza %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });
});

describe("mulRound", () => {
  it("redondea a la mitad hacia arriba sin errores de flotante", () => {
    expect(mulRound(1005, 0.5)).toBe(503); // 502.5 → 503
    expect(mulRound(10000, 0.16)).toBe(1600);
    expect(mulRound(333, 0.16)).toBe(53); // 53.28
    expect(mulRound(-1005, 0.5)).toBe(-503);
  });
});

describe("splitEvenly", () => {
  it("la suma cuadra y el residuo va al último", () => {
    const parts = splitEvenly(100000, 3);
    expect(parts).toEqual([33333, 33333, 33334]);
    expect(sumCents(parts)).toBe(100000);
  });
  it("MSI 12 meses de $10,000.01", () => {
    const parts = splitEvenly(1000001, 12);
    expect(sumCents(parts)).toBe(1000001);
    expect(parts[0]).toBe(83333);
    expect(parts[11]).toBe(83338); // 1000001 - 83333 * 11
  });
});
