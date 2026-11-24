// The review request rule shared by the admin menu and the server (no database).
import { describe, expect, it } from "vitest";
import { isStaff, requestEmail, reviewSkipReason, staffAccounts, type ReviewRequestFacts } from "./rules";

const ok: ReviewRequestFacts = { source: "inperson", status: "completed", owner: null, paid: false, canceled: false, refundedCents: 0, reviewed: false, asked: false, email: "a@x.test", staff: false };

describe("reviewSkipReason", () => {
  it("completed in-person sales and paid, shipped / delivered / picked up website orders are eligible", () => {
    expect(reviewSkipReason(ok)).toBeNull();
    for (const status of ["shipped", "delivered", "picked_up"]) expect(reviewSkipReason({ ...ok, source: "online", status, paid: true })).toBeNull();
    expect(reviewSkipReason({ ...ok, source: "online", status: "delivered", paid: false })).toBe("not_delivered");
    expect(reviewSkipReason({ ...ok, source: "online", status: "paid", paid: true })).toBe("not_delivered");
  });
  it("each reason", () => {
    expect(reviewSkipReason({ ...ok, owner: "A" })).toBe("owner_order");
    expect(reviewSkipReason({ ...ok, staff: true })).toBe("owner_account");
    expect(reviewSkipReason({ ...ok, canceled: true })).toBe("canceled");
    expect(reviewSkipReason({ ...ok, refundedCents: 1 })).toBe("refunded");
    expect(reviewSkipReason({ ...ok, reviewed: true })).toBe("already_reviewed");
    expect(reviewSkipReason({ ...ok, asked: true })).toBe("already_asked");
    expect(reviewSkipReason({ ...ok, asked: true }, { ignoreAsked: true })).toBeNull();
    expect(reviewSkipReason({ ...ok, email: "" })).toBe("no_email");
  });
});

describe("requestEmail", () => {
  it("order email first, then the customer record's, lower case", () => {
    expect(requestEmail("Order@X.test", "c@x.test")).toBe("order@x.test");
    expect(requestEmail("", " C@x.test ")).toBe("c@x.test");
    expect(requestEmail("", null)).toBe("");
  });
});

describe("staffAccounts", () => {
  it("owner purchasers, (owner) / Test names and alert emails", () => {
    const s = staffAccounts(
      [
        { id: "a", name: "Ahmad (owner)", email: "a@x.test" },
        { id: "m", name: "Moe", email: "m@x.test" },
        { id: "t", name: "Test 1", email: "t@x.test" },
        { id: "al", name: "Sam", email: "ALERT@x.test" },
        { id: "c", name: "Tesa Contest", email: "c@x.test" },
      ],
      [
        { customerId: "m", owner: "B" },
        { customerId: "c", owner: null },
      ],
      ["alert@x.test"],
    );
    expect([...s.ids].sort()).toEqual(["a", "al", "m", "t"]);
    expect(isStaff(s, null, "m@x.test")).toBe(true);
    expect(isStaff(s, "c", "c@x.test")).toBe(false);
  });
});
