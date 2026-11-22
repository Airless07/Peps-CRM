import { describe, expect, it } from "vitest";
import { canonicalName } from "./data-migrations";

describe("canonical product names", () => {
  it.each([
    ["Reta", "Retatrutide"],
    ["Reta 10mg", "Retatrutide 10mg"],
    ["Retatrutide 20mg", "Retatrutide 20mg"],
    ["MOTS-C", "MOTS-c"],
    ["MOTS-c 10mg", "MOTS-c 10mg"],
    ["5 Amino", "5-Amino-1MQ"],
    ["5-Amino-1MQ 5mg", "5-Amino-1MQ 5mg"],
    ["CJC/IPA 5mg/5mg", "CJC-1295 (NO DAC) + Ipamorelin 5mg/5mg"],
    ["KLOW", "KLOW"],
    ["Retail box", "Retail box"],
  ])("%s -> %s", (from, to) => expect(canonicalName(from)).toBe(to));
});
