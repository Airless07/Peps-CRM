# Policy wording: suggestions for review

**Status: suggestions only. Nothing here is live.** None of the policies is marked "reviewed".

On 2026-11-23 every `[FILL IN]` on the live policy pages was replaced with neutral wording that adds no new promise (it points customers to support@buckshotlabs.com). The table below shows what is live now and a suggested full answer based on how the store works today. Pick or edit the wording you want, paste it in **Admin → Content → Policies**, have the pages reviewed (ideally by a lawyer), then tick "I had this reviewed".

`{support_email}` is filled in automatically with the support address.

What the suggestions are based on (from the code and the live settings):

- Payment: Zelle only on the website today. An order counts only after you press **Mark paid**. Unpaid orders cancel after 24 hours.
- Shipping: USPS through Shippo. Standard (2–5 business days) and Priority (1–3 business days). The customer gets a tracking email as soon as the label is bought.
- Refunds: the admin **Refund** action records full or partial refunds. A refund comes off the items first, then off shipping, so shipping *can* be refunded. Refunds are sent by you through the payment method used (Zelle), by hand.
- Store credit used on a canceled order goes back to the customer. Referral credit is taken back on refund or cancel.
- The business is in Michigan (Dearborn Heights address on file).

---

## 1. Terms of Service → Governing law

- **Was:** `[FILL IN: the state whose laws govern these terms.]`
- **Live now:** Contact {support_email} for details.
- **Suggested:**
  > These terms are governed by the laws of the State of Michigan, without regard to its conflict of law rules. Any dispute about an order will be handled in the state or federal courts located in Wayne County, Michigan.

  Check with a lawyer: the state, the county, and whether you want an arbitration clause instead.

## 2. Shipping Policy → Processing time

- **Was:** `[FILL IN: how many business days after payment an order usually ships.]`
- **Live now:** Contact {support_email} for details on processing times.
- **Suggested:**
  > Orders usually ship within 1–2 business days after payment is confirmed. Orders paid on weekends or holidays ship the next business day. Payment is confirmed by hand, so a payment sent late in the day may be confirmed the next business day.

  Only promise a number you can keep every week.

## 3. Shipping Policy → Lost or damaged packages

- **Was:** "...email {support_email} within `[FILL IN: number of days]` days of delivery with your order number, and we will help resolve it."
- **Live now:** "...email {support_email} with your order number, and we will help resolve it." (no deadline)
- **Suggested:**
  > If your package arrives damaged or tracking shows a problem, email {support_email} within 7 days of delivery (or within 14 days of the ship date if tracking stops updating) with your order number and photos of the package, and we will help resolve it. For a package marked delivered that you did not receive, please check with neighbors and your local post office first; we will then open a claim with the carrier.

## 4. Refund & Return Policy → Returns

- **Was:** `[FILL IN: whether unopened products can be returned, and within how many days.]`
- **Live now:** Contact {support_email} for details about unopened products.
- **Suggested (pick one):**
  - *No returns:*
    > All sales are final. We cannot accept returns of opened or unopened products, because we cannot verify how a product was stored once it has left us. This does not affect damaged or incorrect items (see below).
  - *Unopened returns allowed:*
    > Unopened products with the seal intact can be returned within 14 days of delivery. Email {support_email} first for approval. The customer pays return shipping. Once we receive and check the item, we refund the item price.

  Research materials are usually sold "all sales final"; the first option is the simpler promise to keep.

## 5. Refund & Return Policy → Damaged or incorrect items

- **Was:** "...email {support_email} within `[FILL IN: number of days]` days of delivery with your order number and a photo."
- **Live now:** "...email {support_email} with your order number and a photo." (no deadline)
- **Suggested:**
  > If an item arrives damaged or you received the wrong item, email {support_email} within 7 days of delivery with your order number and a photo. We will replace the item or refund it.

  Use the same number of days as in the Shipping Policy (section 3).

## 6. Refund & Return Policy → How refunds are sent

- **Was:** `[FILL IN: how many business days a refund usually takes.] [FILL IN: whether shipping costs are refunded.]`
- **Live now:** Contact {support_email} for details on refund timing and shipping costs.
- **Suggested:**
  > Approved refunds are sent within 3 business days through the payment method you used (for Zelle, to the same Zelle account). Shipping costs are refunded when the refund is because of our mistake (a damaged, wrong or missing item, or an order we canceled). Shipping is not refunded for an order canceled at your request after the label was bought.

  The money logic already supports refunding shipping (refunds come off items first, then shipping), so either choice works with the admin.

---

## After you choose

1. Admin → Content → Policies: paste the wording.
2. Have all five policy pages reviewed.
3. Tick "I had this reviewed" on each one. The launch checklist turns green.
