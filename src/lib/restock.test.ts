// Restock order math (pure): adding lines, merging the same size, per-box math, free items, fee % spread,
// the review totals, and cost per vial weighted with the stock already there.
import { describe, expect, it } from "vitest";
import { addLine, costAfter, defaultRestockName, lineFrom, planRestock, pricesOf, spread, vialsFrom, type RestockLineInput } from "./restock";

const L = (productId: string, quantity: number, lineCents: number, free = false): RestockLineInput => ({ productId, quantity, lineCents, free });
const none = { shippingCents: 0, shippingDiscountCents: 0, discountCents: 0, feeMode: "amount" as const, feeValue: 0 };

describe("adding lines", () => {
  it("adds lines in order; the same product/size merges into one line", () => {
    let lines: RestockLineInput[] = [];
    lines = addLine(lines, L("rt10", 20, 17000));
    lines = addLine(lines, L("klow", 20, 38000));
    lines = addLine(lines, L("rt10", 10, 8500));
    expect(lines).toEqual([L("rt10", 30, 25500), L("klow", 20, 38000)]);
  });
  it("a free vial of a size already in the order stays its own $0 line", () => {
    const lines = addLine(addLine([L("rt10", 20, 17000)], L("rt10", 1, 999, true)), L("rt10", 1, 0, true));
    expect(lines).toEqual([L("rt10", 20, 17000), { ...L("rt10", 2, 0, true) }]);
  });
});

describe("quantity and price", () => {
  it("boxes x vials per box (default 10), or vials", () => {
    expect(vialsFrom("boxes", 0, 2, 10)).toBe(20);
    expect(vialsFrom("boxes", 0, 3, 5)).toBe(15);
    expect(vialsFrom("vials", 7, 99, 10)).toBe(7);
  });
  it("price per vial, per box or line total all give the same line total", () => {
    expect(lineFrom("vial", 850, 20, 10)).toBe(17000);
    expect(lineFrom("box", 8500, 20, 10)).toBe(17000);
    expect(lineFrom("line", 17000, 20, 10)).toBe(17000);
    expect(pricesOf(17000, 20, 10)).toEqual({ vial: 850, box: 8500, line: 17000 });
  });
});

describe("plan (the review screen totals)", () => {
  it("free items cost $0 and get none of the extras", () => {
    const p = planRestock([L("rt10", 20, 17000), L("rt10", 1, 0, true)], { ...none, shippingCents: 1000 });
    expect(p.lines.map((l) => l.costCents)).toEqual([18000, 0]);
    expect(p.lines[1].unitAfterCents).toBe(0);
  });
  it("a fee in % is spread over the paid items by their share of cost; the lines add up to the total", () => {
    const p = planRestock([L("a", 10, 10000), L("b", 10, 30000), L("free", 5, 0, true)], { ...none, feeMode: "percent", feeValue: 500 });
    expect(p.feeCents).toBe(2000);
    expect(p.totalCents).toBe(42000);
    expect(p.lines.map((l) => l.costCents)).toEqual([10500, 31500, 0]);
    expect(p.lines.map((l) => l.unitAfterCents)).toEqual([1050, 3150, 0]);
    expect(p.lines.map((l) => l.unitBeforeCents)).toEqual([1000, 3000, 0]);
  });
  it("Batch #1 (shipment 2) as one order: $1,665 + $100 shipping - $100 waived - $4 + $83 fee = $1,744", () => {
    const lines = [
      L("RT10", 20, 17000), L("RT20", 20, 28000), L("KL80", 20, 38000), L("MS10", 10, 6500), L("MS20", 20, 18000),
      L("CU100", 20, 10000), L("MT2", 20, 8000), L("CP10", 30, 30000), L("KP10", 10, 6000), L("BA10", 50, 5000), L("RT10", 1, 0, true),
    ];
    const p = planRestock(lines, { shippingCents: 10000, shippingDiscountCents: 10000, discountCents: 400, feeMode: "amount", feeValue: 8300 });
    expect(p).toMatchObject({ productsCents: 166500, shippingCents: 10000, discountsCents: 10400, feeCents: 8300, totalCents: 174400, error: "" });
    expect(p.lines.reduce((a, l) => a + l.costCents, 0)).toBe(174400);
    expect(p.lines.map((l) => (l.unitAfterCents / 100).toFixed(2))).toEqual(["8.90", "14.66", "19.90", "6.81", "9.43", "5.24", "4.19", "10.47", "6.29", "1.05", "0.00"]);
    // 5% of the subtotal would be $83.05: the fee as an amount is what was really charged.
    expect(planRestock(lines, { shippingCents: 10000, shippingDiscountCents: 10000, discountCents: 400, feeMode: "percent", feeValue: 500 }).feeCents).toBe(8305);
  });
  it("says what is missing", () => {
    expect(planRestock([], none).error).toMatch(/Add at least one product/);
    expect(planRestock([L("a", 0, 100)], none).error).toMatch(/at least 1 vial/);
    expect(planRestock([L("a", 1, 100)], { ...none, discountCents: 500 }).error).toMatch(/more than the order/);
    expect(planRestock([L("a", 1, 0, true)], { ...none, shippingCents: 500 }).error).toMatch(/paid item/);
    expect(planRestock([L("a", 1, 0, true)], none).error).toBe("");
  });
  it("spread always adds up exactly", () => {
    const out = spread([1, 1, 1], 100);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(spread([0, 0], 100)).toEqual([0, 0]);
  });
});

describe("cost per vial (weighted with the stock already there)", () => {
  it("new stock is averaged with what is left", () => {
    expect(costAfter(10, 1000, { qty: 0, cents: 0 }, { qty: 20, cents: 17807 })).toBe(Math.round((10000 + 17807) / 30));
  });
  it("with no stock left, the new units set the cost", () => {
    expect(costAfter(0, 1000, { qty: 0, cents: 0 }, { qty: 20, cents: 17000 })).toBe(850);
    expect(costAfter(-3, 1000, { qty: 0, cents: 0 }, { qty: 20, cents: 17000 })).toBe(850);
  });
  it("an edit takes the old units out at their cost, then adds the new ones (by the difference)", () => {
    const after = costAfter(10, 1000, { qty: 0, cents: 0 }, { qty: 10, cents: 5000 }); // 750
    expect(after).toBe(750);
    expect(costAfter(20, after, { qty: 10, cents: 5000 }, { qty: 10, cents: 7000 })).toBe(850);
    // delete: back to where it was
    expect(costAfter(20, after, { qty: 10, cents: 5000 }, { qty: 0, cents: 0 })).toBe(1000);
    // everything sold already: nothing left to average, the cost stays
    expect(costAfter(5, after, { qty: 10, cents: 5000 }, { qty: 0, cents: 0 })).toBe(after);
  });
  it("default name", () => {
    expect(defaultRestockName("2026-11-26")).toBe("Restock Nov 26, 2026");
  });
});
