import { describe, expect, it } from "vitest";
import { findTestData } from "./test-data";

const order = (o: Record<string, unknown>) => ({ id: "o", number: 1008, customer: "Moe (owner)", note: "", adminNote: "", web: { email: "a@gmail.com", cancelReason: "" }, ...o }) as never;

describe("test data finder (launch checklist)", () => {
  it("flags orders canceled or noted as tests and example emails; never a real person by name", () => {
    const found = findTestData({
      orders: [order({ id: "real" }), order({ id: "t1", web: { email: "x@gmail.com", cancelReason: "Canceled: test order" } })],
      pendingOrders: [order({ id: "t2", web: { email: "ann@example.com", cancelReason: "" } })],
      customers: [{ id: "c1", name: "Test 1", email: "buckshotlabss@gmail.com" }, { id: "c2", name: "Dana", email: "dana@shop.test" }] as never,
      reviews: [{ id: "r", text: "Lorem ipsum dolor", displayName: "A" }] as never,
      messages: [],
      promotions: [{ id: "p", code: "EARLY", name: "" }, { id: "p2", code: "TEST50", name: "" }] as never,
    });
    expect(found.map((f) => f.id)).toEqual(["t1", "t2", "c2", "r", "p2"]);
  });
});
