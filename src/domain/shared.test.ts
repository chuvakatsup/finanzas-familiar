import { describe, expect, it } from "vitest";
import { computeShares, evenPercentText, ownShareTxs, parsePartValue } from "./shared";

const ok = (r: ReturnType<typeof computeShares>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("computeShares: porcentaje", () => {
  it("mitad y mitad: $1,000 → $500 para el otro, $500 para quien paga", () => {
    const r = ok(computeShares(100_000, "porcentaje", [{ userId: "mama", value: 5000 }]));
    expect(r.shares).toEqual([{ userId: "mama", amount: 50_000, percentBp: 5000 }]);
    expect(r.ownerShare).toBe(50_000);
  });

  it("100% para otra persona: quien paga no se queda con nada", () => {
    const r = ok(computeShares(12_345, "porcentaje", [{ userId: "mama", value: 10_000 }]));
    expect(r.shares[0].amount).toBe(12_345);
    expect(r.ownerShare).toBe(0);
  });

  it("tercios que suman 100%: el residuo va en la última parte y la suma cuadra exacto", () => {
    const r = ok(
      computeShares(100_000, "porcentaje", [
        { userId: "a", value: 3333 },
        { userId: "b", value: 3333 },
        { userId: "c", value: 3334 },
      ]),
    );
    expect(r.shares.map((s) => s.amount)).toEqual([33_330, 33_330, 33_340]);
    expect(r.ownerShare).toBe(0);
  });

  it("redondea a la mitad hacia arriba (como los bancos)", () => {
    const r = ok(computeShares(1_001, "porcentaje", [{ userId: "a", value: 5000 }]));
    expect(r.shares[0].amount).toBe(501);
    expect(r.ownerShare).toBe(500);
  });

  it("más de 100% no se acepta", () => {
    const r = computeShares(100_000, "porcentaje", [
      { userId: "a", value: 6000 },
      { userId: "b", value: 5000 },
    ]);
    expect(r).toEqual({ ok: false, error: "Los porcentajes suman más de 100%." });
  });

  it("una parte que se redondea a $0 no se acepta", () => {
    const r = computeShares(1, "porcentaje", [{ userId: "a", value: 100 }]);
    expect(r.ok).toBe(false);
  });
});

describe("computeShares: monto", () => {
  it("cantidades fijas; el resto es de quien paga", () => {
    const r = ok(
      computeShares(90_000, "monto", [
        { userId: "a", value: 30_000 },
        { userId: "b", value: 20_000 },
      ]),
    );
    expect(r.shares.map((s) => [s.amount, s.percentBp])).toEqual([
      [30_000, null],
      [20_000, null],
    ]);
    expect(r.ownerShare).toBe(40_000);
  });

  it("no pueden sumar más que el gasto", () => {
    expect(computeShares(10_000, "monto", [{ userId: "a", value: 10_001 }]).ok).toBe(false);
  });

  it("sin personas, repetidas o en cero: error amable", () => {
    expect(computeShares(10_000, "monto", []).ok).toBe(false);
    expect(
      computeShares(10_000, "monto", [
        { userId: "a", value: 1 },
        { userId: "a", value: 1 },
      ]).ok,
    ).toBe(false);
    expect(computeShares(10_000, "monto", [{ userId: "a", value: 0 }]).ok).toBe(false);
  });
});

describe("parsePartValue / evenPercentText", () => {
  it("lee porcentajes y pesos como los escribe la persona", () => {
    expect(parsePartValue("porcentaje", "50")).toBe(5000);
    expect(parsePartValue("porcentaje", "33.33")).toBe(3333);
    expect(parsePartValue("porcentaje", "101")).toBeNull();
    expect(parsePartValue("porcentaje", "0")).toBeNull();
    expect(parsePartValue("monto", "1500")).toBe(150_000);
    expect(parsePartValue("monto", "abc")).toBeNull();
  });

  it("propone partes iguales incluyendo a quien paga", () => {
    expect(evenPercentText(2)).toBe("50");
    expect(evenPercentText(3)).toBe("33.33");
    expect(evenPercentText(4)).toBe("25");
  });
});

describe("ownShareTxs", () => {
  it("al dueño solo le cuenta su parte; si repartió todo, el gasto no le cuenta", () => {
    const txs = [
      { id: "t1", amount: 100_000 },
      { id: "t2", amount: 30_000 },
      { id: "t3", amount: 5_000 },
    ];
    const out = ownShareTxs(
      txs,
      new Map([
        ["t1", 50_000],
        ["t2", 30_000],
      ]),
    );
    expect(out).toEqual([
      { id: "t1", amount: 50_000 },
      { id: "t3", amount: 5_000 },
    ]);
  });
});
