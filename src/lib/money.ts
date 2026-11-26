/**
 * The money engine. One pure function: raw records in, every balance out.
 * Nothing in the database stores a running balance; everything is derived here,
 * processing records in chronological order. All money is integer cents.
 */
import type {
  AppData,
  DiscountType,
  OrderLineRec,
  OrderRec,
  Seller,
  SettingsRec,
} from "./types";

const EPS = 1e-9;
/** Floor that tolerates float noise like 0.1 * 30 = 2.9999999. */
const floorC = (n: number) => Math.floor(n + EPS);

// ---------------------------------------------------------------------------
// Order totals
// ---------------------------------------------------------------------------

export function discountAmount(type: DiscountType, value: number, subtotal: number): number {
  if (subtotal <= 0) return 0;
  const raw = type === "%" ? (subtotal * (value || 0)) / 100 : value || 0;
  return Math.max(0, Math.min(subtotal, Math.round(raw)));
}

/**
 * Spread a discount over line amounts in proportion to each line's share.
 * Each share is rounded to the cent; any leftover cent goes on the largest line.
 * Returns the discount allocated to each line (same order as input).
 */
export function allocateDiscount(gross: number[], discount: number): number[] {
  const subtotal = gross.reduce((s, g) => s + g, 0);
  if (subtotal <= 0 || discount <= 0) return gross.map(() => 0);
  const d = Math.min(discount, subtotal);
  const alloc = gross.map((g) => Math.round((d * g) / subtotal));
  const diff = d - alloc.reduce((s, a) => s + a, 0);
  if (diff !== 0) {
    let largest = 0;
    gross.forEach((g, i) => {
      if (g > gross[largest]) largest = i;
    });
    alloc[largest] += diff;
  }
  return alloc;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  tip: number;
  /** Shipping charged to the customer (website orders). 0 for in-person sales. */
  shipping: number;
  /** Store credit used. Works like a discount (never more than subtotal - discount). */
  credit: number;
  /** Money given back after the order counted (refunds). First off the items, then off shipping. */
  refunded: number;
  /** Part of `refunded` that came off shipping. */
  refundedShipping: number;
  /** What the customer pays, net of refunds: subtotal - discount - credit + tip + shipping - refunded. */
  total: number;
  /** Revenue after discount for each line, in the order of `lines` passed in. */
  lineRevenue: number[];
}

type TotalsInput = Pick<OrderRec, "discountType" | "discountValue" | "tipCents"> & {
  shippingCents?: number;
  storeCreditCents?: number;
  /** Refunded after the order counted. 0 on every order before refunds existed. */
  refundedCents?: number;
  lines: Pick<OrderLineRec, "quantity" | "unitPriceCents">[];
};

export function orderTotals(order: TotalsInput): OrderTotals {
  const gross = order.lines.map((l) => l.quantity * l.unitPriceCents);
  const subtotal = gross.reduce((s, g) => s + g, 0);
  const discount = discountAmount(order.discountType, order.discountValue, subtotal);
  // Store credit comes off after the discount, like a second discount. 0 on every order before credit existed.
  const credit = Math.max(0, Math.min(subtotal - discount, Math.round(order.storeCreditCents || 0)));
  const tip = Math.max(0, order.tipCents || 0);
  const shipping = Math.max(0, order.shippingCents || 0);
  // A refund lowers revenue like a late discount: first the items (spread over the lines), then shipping. Never the tip.
  const wantRefund = Math.max(0, Math.round(order.refundedCents || 0));
  const refundItems = Math.min(wantRefund, subtotal - discount - credit);
  const refundedShipping = Math.min(wantRefund - refundItems, shipping);
  const alloc = allocateDiscount(gross, discount + credit + refundItems);
  return {
    subtotal,
    discount,
    tip,
    shipping,
    credit,
    refunded: refundItems + refundedShipping,
    refundedShipping,
    total: subtotal - discount - credit + tip + shipping - refundItems - refundedShipping,
    lineRevenue: gross.map((g, i) => g - alloc[i]),
  };
}

// ---------------------------------------------------------------------------
// Splitting helpers
// ---------------------------------------------------------------------------

/** Split an amount between partners by ratio. Leftover cents stay with the business. */
export function splitByRatio(amount: number, ratioA: number): { a: number; b: number } {
  if (amount <= 0) return { a: 0, b: 0 };
  return { a: floorC((amount * ratioA) / 100), b: floorC((amount * (100 - ratioA)) / 100) };
}

/** The splittable part of a profit after the business cut (rounding goes to the business). */
export function splittableAfterCut(profit: number, cutPercent: number): number {
  if (profit <= 0) return 0;
  return Math.max(0, floorC((profit * (100 - cutPercent)) / 100));
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface LineResult {
  lineId: string;
  productId: string | null;
  quantity: number;
  gross: number;
  revenue: number;
  cost: number;
  profit: number;
  /** Part of revenue that went to paying the business back to $0. */
  payback: number;
  a: number;
  b: number;
  business: number;
}

export interface OrderResult {
  orderId: string;
  date: string;
  soldBy: Seller;
  subtotal: number;
  discount: number;
  /** Store credit used (lowers revenue like a discount). */
  credit: number;
  /** Refunded after the sale (lowers revenue, then shipping). */
  refunded: number;
  tip: number;
  /** Shipping charged. All of it is business money, none is split. */
  shipping: number;
  total: number;
  /** Revenue after discount and store credit (excludes tip). */
  revenue: number;
  cost: number;
  /** revenue - cost (excludes tip). */
  profit: number;
  units: number;
  lines: LineResult[];
  tipA: number;
  tipB: number;
  tipBusiness: number;
  /** Totals for the whole order (lines + tip + shipping). */
  a: number;
  b: number;
  business: number;
}

export interface ProductStock {
  stock: number;
  purchasedQty: number;
  purchasedCost: number;
  /** Weighted average from purchases (null if never purchased). */
  avgCost: number | null;
  /** Override if set, else weighted average, else 0. */
  unitCost: number;
  soldQty: number;
  /** Units set aside by saved (not yet completed) Sell orders. Already taken out of `stock`. */
  heldQty: number;
}

export interface Ledger {
  businessCents: number;
  /** Money splittable but not yet confirmed in a split (can be negative after edits). */
  pendingA: number;
  pendingB: number;
  /** Confirmed through splits. */
  earnedA: number;
  earnedB: number;
  paidA: number;
  paidB: number;
  /** Shipping charged to customers on counted orders (already inside businessCents). */
  shippingCollected: number;
  /** What was spent on shipping labels (already subtracted from businessCents). */
  labelCosts: number;
  /** All expenses (lab testing, supplies...), already subtracted from businessCents. */
  expenseCosts: number;
  /**
   * Partner shares that were waiting to be split when a cost (restock, expense, label, payout) pushed business
   * money below $0. No split during payback: they went back to the business. Already inside businessCents.
   */
  returnedToPayback: number;
  inPayback: boolean;
  /** Cents left to reach $0 (0 when not in payback). */
  leftToBreakEven: number;
  /** Lowest balance of the current payback stretch (for the progress bar). */
  paybackLow: number;
  orders: Map<string, OrderResult>;
  stock: Map<string, ProductStock>;
  /** Balance after each dated event, for charts / debugging. */
  history: { date: string; balance: number }[];
}

type Ev = { kind: 0 | 1 | 2 | 3; date: string; tie: string; apply: () => void };

const ts = (d: string) => new Date(d).getTime();

export function computeLedger(data: AppData): Ledger {
  const s: SettingsRec = data.settings;
  let bal = s.startingBalanceCents;
  let low = Math.min(0, bal);
  const history: Ledger["history"] = [];
  const orders = new Map<string, OrderResult>();
  const stock = new Map<string, ProductStock>();

  const stockOf = (pid: string) => {
    let st = stock.get(pid);
    if (!st) {
      st = { stock: 0, purchasedQty: 0, purchasedCost: 0, avgCost: null, unitCost: 0, soldQty: 0, heldQty: 0 };
      stock.set(pid, st);
    }
    return st;
  };
  for (const p of data.products) stockOf(p.id);

  // Orders already in a split (as of the event being processed): their shares are paid out, never taken back.
  const splitDone = new Set<string>();
  let returnedToPayback = 0;
  /** A cost left business money below $0: every share not split yet goes back to the business (payback). */
  const costHit = () => {
    if (bal >= 0) return;
    for (const [id, r] of orders) {
      if (splitDone.has(id) || (r.a === 0 && r.b === 0)) continue;
      returnedToPayback += r.a + r.b;
      r.business += r.a + r.b;
      r.a = 0;
      r.b = 0;
      r.tipBusiness = r.tip;
      r.tipA = 0;
      r.tipB = 0;
      for (const lr of r.lines) {
        lr.business = lr.revenue;
        lr.a = 0;
        lr.b = 0;
      }
    }
  };

  const track = (date: string) => {
    if (bal < 0) low = Math.min(low, bal);
    else low = 0;
    history.push({ date, balance: bal });
  };

  /**
   * Take `amount` of incoming money. Returns the fraction of it that follows
   * the normal rule (the rest paid the business back toward $0).
   */
  const receive = (amount: number): { normalFraction: number; payback: number } => {
    if (amount <= 0) {
      bal += amount;
      return { normalFraction: bal >= 0 ? 1 : 0, payback: 0 };
    }
    if (bal >= 0) {
      bal += amount;
      return { normalFraction: 1, payback: 0 };
    }
    const need = -bal;
    bal += amount;
    if (amount <= need) return { normalFraction: 0, payback: amount };
    return { normalFraction: (amount - need) / amount, payback: need };
  };

  const events: Ev[] = [];

  for (const p of data.purchases) {
    events.push({
      kind: 0,
      date: p.date,
      tie: p.createdAt + p.id,
      apply: () => {
        const st = stockOf(p.productId);
        st.stock += p.quantity;
        st.purchasedQty += p.quantity;
        st.purchasedCost += p.totalCostCents;
        if (!p.fromInvestment) {
          bal -= p.totalCostCents;
          costHit();
        }
        track(p.date);
      },
    });
  }
  for (const a of data.adjustments) {
    events.push({
      kind: 0,
      date: a.date,
      tie: a.createdAt + a.id,
      apply: () => {
        stockOf(a.productId).stock += a.quantity;
      },
    });
  }
  for (const o of data.orders) {
    events.push({
      kind: 1,
      date: o.date,
      tie: o.createdAt + o.id,
      apply: () => {
        orders.set(o.id, processOrder(o));
        track(o.date);
      },
    });
  }
  for (const sp of data.splits) {
    events.push({
      kind: 2,
      date: sp.date,
      tie: sp.createdAt + sp.id,
      apply: () => {
        bal -= sp.partnerACents + sp.partnerBCents;
        for (const it of sp.items) if (it.orderId) splitDone.add(it.orderId);
        track(sp.date);
      },
    });
  }
  for (const p of data.payouts) {
    if (p.splitId) continue; // split already moved this money out of the business
    events.push({
      kind: 3,
      date: p.date,
      tie: p.createdAt + p.id,
      apply: () => {
        bal -= p.amountCents;
        costHit();
        track(p.date);
      },
    });
  }

  // Shipping labels: a plain business expense on the day the label was bought.
  let labelCosts = 0;
  for (const l of data.labels ?? []) {
    if (l.voided || l.costCents <= 0) continue;
    events.push({
      kind: 3,
      date: l.date,
      tie: l.createdAt + l.id,
      apply: () => {
        bal -= l.costCents;
        costHit();
        labelCosts += l.costCents;
        track(l.date);
      },
    });
  }

  // Expenses: business money spent on their date, exactly like a restock (it can push the business below $0,
  // which turns on payback mode until sales bring it back). Same place in the day as restocks.
  let expenseCosts = 0;
  for (const x of data.expenses ?? []) {
    if (!(x.amountCents > 0)) continue;
    events.push({
      kind: 0,
      date: x.date,
      tie: x.createdAt + x.id,
      apply: () => {
        bal -= x.amountCents;
        costHit();
        expenseCosts += x.amountCents;
        track(x.date);
      },
    });
  }

  let shippingCollected = 0;

  function processOrder(o: OrderRec): OrderResult {
    const lines = [...o.lines].sort((x, y) => x.sortOrder - y.sortOrder);
    const totals = orderTotals({ ...o, lines });
    // Owner purchase (a partner buying at cost): nothing is ever splittable, all of it is business money.
    const owner = !!o.owner;
    const results: LineResult[] = [];
    let a = 0;
    let b = 0;
    lines.forEach((l, i) => {
      const revenue = totals.lineRevenue[i];
      const cost = l.quantity * l.unitCostCents;
      const profit = revenue - cost;
      const { normalFraction, payback } = receive(revenue);
      const full = owner ? 0 : splittableAfterCut(profit, l.cutPercent);
      const splittable = normalFraction >= 1 ? full : floorC(full * normalFraction);
      const sh = splitByRatio(splittable, s.partnerARatio);
      a += sh.a;
      b += sh.b;
      results.push({
        lineId: l.id,
        productId: l.productId,
        quantity: l.quantity,
        gross: l.quantity * l.unitPriceCents,
        revenue,
        cost,
        profit,
        payback,
        a: sh.a,
        b: sh.b,
        business: revenue - sh.a - sh.b,
      });
      if (l.productId) {
        const st = stockOf(l.productId);
        st.stock -= l.quantity;
        st.soldQty += l.quantity;
      }
    });

    // Tip: no cost. Payback first, then the tip handling rule.
    let tipA = 0;
    let tipB = 0;
    const tip = totals.tip;
    if (tip > 0) {
      const { normalFraction } = receive(tip);
      const normalPart = normalFraction >= 1 ? tip : floorC(tip * normalFraction);
      if (normalPart > 0 && !owner) {
        if (s.tipHandling === "profit") {
          const cut = lines.length ? lines[0].cutPercent : s.businessCutPercent;
          const sh = splitByRatio(splittableAfterCut(normalPart, cut), s.partnerARatio);
          tipA = sh.a;
          tipB = sh.b;
        } else if (s.tipHandling === "seller") {
          if (o.soldBy === "A") tipA = normalPart;
          else if (o.soldBy === "B") tipB = normalPart;
          // "W" (website) has no seller: the tip stays with the business.
        }
      }
    }
    a += tipA;
    b += tipB;
    // Shipping charged: 100% business money, after the lines and tip, never split.
    // (It still lifts the balance, so it counts toward paying the business back.)
    const shipping = totals.shipping - totals.refundedShipping;
    if (shipping > 0) {
      bal += shipping;
      shippingCollected += shipping;
    }
    const revenue = totals.subtotal - totals.discount - totals.credit - (totals.refunded - totals.refundedShipping);
    const cost = results.reduce((x, r) => x + r.cost, 0);
    return {
      orderId: o.id,
      date: o.date,
      soldBy: o.soldBy,
      subtotal: totals.subtotal,
      discount: totals.discount,
      credit: totals.credit,
      refunded: totals.refunded,
      tip,
      shipping,
      total: totals.total,
      revenue,
      cost,
      profit: revenue - cost,
      units: lines.reduce((x, l) => x + l.quantity, 0),
      lines: results,
      tipA,
      tipB,
      tipBusiness: tip - tipA - tipB,
      a,
      b,
      business: revenue + tip + shipping - a - b,
    };
  }

  events.sort((x, y) => {
    const d = ts(x.date) - ts(y.date);
    if (d !== 0) return d;
    if (x.kind !== y.kind) return x.kind - y.kind;
    return x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0;
  });
  for (const e of events) e.apply();

  // Saved Sell orders hold their items: the units come out of stock while the order is saved (so they
  // can't be sold twice, in person or on the website) and go back if it is deleted. Money is not
  // touched until the order is completed; completing it turns the hold into a normal sale.
  for (const so of data.savedOrders ?? []) {
    for (const l of so.lines) {
      if (!l.productId || !(l.quantity > 0)) continue;
      const st = stockOf(l.productId);
      st.stock -= l.quantity;
      st.heldQty += l.quantity;
    }
  }

  for (const p of data.products) {
    const st = stockOf(p.id);
    st.avgCost = st.purchasedQty > 0 ? Math.round(st.purchasedCost / st.purchasedQty) : null;
    st.unitCost = p.costOverrideCents ?? st.avgCost ?? 0;
  }

  let sumA = 0;
  let sumB = 0;
  for (const r of orders.values()) {
    sumA += r.a;
    sumB += r.b;
  }
  const earnedA = data.splits.reduce((x, sp) => x + sp.partnerACents, 0);
  const earnedB = data.splits.reduce((x, sp) => x + sp.partnerBCents, 0);
  const paidA = data.payouts.filter((p) => p.person === "A").reduce((x, p) => x + p.amountCents, 0);
  const paidB = data.payouts.filter((p) => p.person === "B").reduce((x, p) => x + p.amountCents, 0);

  return {
    businessCents: bal,
    pendingA: sumA - earnedA,
    pendingB: sumB - earnedB,
    earnedA,
    earnedB,
    paidA,
    paidB,
    shippingCollected,
    labelCosts,
    expenseCosts,
    returnedToPayback,
    inPayback: bal < 0,
    leftToBreakEven: bal < 0 ? -bal : 0,
    paybackLow: bal < 0 ? Math.min(low, bal) : 0,
    orders,
    stock,
    history,
  };
}

// ---------------------------------------------------------------------------
// Split plan
// ---------------------------------------------------------------------------

export interface SplitPlanItem {
  orderId: string | null;
  partnerACents: number;
  partnerBCents: number;
  businessCents: number;
  /** True when the order was already split before and this is a correction. */
  adjustment: boolean;
}

export interface SplitPlan {
  items: SplitPlanItem[];
  partnerACents: number;
  partnerBCents: number;
  businessCents: number;
  newOrderIds: string[];
  adjustedOrderIds: string[];
  hasOrphanAdjustment: boolean;
}

/** What the next split would record. Its partner totals always equal the ledger's pending amounts. */
export function planSplit(data: AppData, ledger: Ledger = computeLedger(data)): SplitPlan {
  const covered = new Map<string | null, { a: number; b: number; biz: number }>();
  const orderIds = new Set(data.orders.map((o) => o.id));
  for (const sp of data.splits) {
    for (const it of sp.items) {
      const key = it.orderId && orderIds.has(it.orderId) ? it.orderId : null;
      const c = covered.get(key) ?? { a: 0, b: 0, biz: 0 };
      c.a += it.partnerACents;
      c.b += it.partnerBCents;
      c.biz += it.businessCents;
      covered.set(key, c);
    }
  }
  const items: SplitPlanItem[] = [];
  const newOrderIds: string[] = [];
  const adjustedOrderIds: string[] = [];
  const sorted = [...data.orders].sort((x, y) => ts(x.date) - ts(y.date));
  for (const o of sorted) {
    const r = ledger.orders.get(o.id);
    if (!r) continue;
    const c = covered.get(o.id);
    if (!c) {
      items.push({ orderId: o.id, partnerACents: r.a, partnerBCents: r.b, businessCents: r.business, adjustment: false });
      newOrderIds.push(o.id);
    } else {
      const da = r.a - c.a;
      const db = r.b - c.b;
      const dz = r.business - c.biz;
      if (da !== 0 || db !== 0 || dz !== 0) {
        items.push({ orderId: o.id, partnerACents: da, partnerBCents: db, businessCents: dz, adjustment: true });
        adjustedOrderIds.push(o.id);
      }
    }
  }
  const orphan = covered.get(null);
  const hasOrphanAdjustment = !!orphan && (orphan.a !== 0 || orphan.b !== 0 || orphan.biz !== 0);
  if (orphan && hasOrphanAdjustment) {
    items.push({ orderId: null, partnerACents: -orphan.a, partnerBCents: -orphan.b, businessCents: -orphan.biz, adjustment: true });
  }
  return {
    items,
    partnerACents: items.reduce((x, i) => x + i.partnerACents, 0),
    partnerBCents: items.reduce((x, i) => x + i.partnerBCents, 0),
    businessCents: items.reduce((x, i) => x + i.businessCents, 0),
    newOrderIds,
    adjustedOrderIds,
    hasOrphanAdjustment,
  };
}

/** Orders that have been included in at least one split. */
export function splitOrderIds(data: AppData): Set<string> {
  const set = new Set<string>();
  for (const sp of data.splits) for (const it of sp.items) if (it.orderId) set.add(it.orderId);
  return set;
}
