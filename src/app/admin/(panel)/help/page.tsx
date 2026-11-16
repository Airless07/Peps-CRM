"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

const HOW_TOS: { title: string; where: { label: string; href: string }; steps: string[] }[] = [
  {
    title: "Record an in-person sale",
    where: { label: "Sell", href: "/admin/sell" },
    steps: ["Open Sell and tap each product the customer is buying.", "Tap the cart bar at the bottom. Set the payment method, customer and any discount or tip.", "Tap Complete order. Stock, money and the Orders list update right away."],
  },
  {
    title: "Confirm a payment",
    where: { label: "Orders", href: "/admin/orders?view=open" },
    steps: [
      "A new website order shows as “Awaiting payment”. If the customer uploaded a screenshot, the row says so.",
      "Check Zelle or Cash App for the exact amount with the order number in the memo.",
      "Tap Mark paid. The big order number, name and amount make it easy to match. Pick the payment method and confirm.",
      "The order becomes a normal sale: stock goes down, the money math runs, and the customer is emailed.",
    ],
  },
  {
    title: "Ship an order",
    where: { label: "Ship queue", href: "/admin/ship" },
    steps: ["Open Ship queue. It shows one paid order at a time, oldest first.", "Tap Buy label, pick the price, and confirm. Tracking is saved and emailed to the customer.", "Tap Open label to print, then Print packing slip.", "Hand the package to the carrier and tap Mark shipped, then Next order."],
  },
  {
    title: "Add a product",
    where: { label: "Inventory", href: "/admin/inventory?add=1" },
    steps: ["Open Inventory and tap + Product. Enter the name and price, then Save.", "Tap Restock on the new product to set its stock and cost.", "To sell it online, tap Edit, open the Website tab, add photos and details, and turn on “Show on website”."],
  },
  {
    title: "Combine sizes",
    where: { label: "Inventory", href: "/admin/inventory" },
    steps: ["Open Inventory and tap “Combine into one product”.", "Tick the products that are the same compound in different sizes.", "Check the product name and the label for each size (for example 5mg and 10mg), then tap Combine.", "Each size keeps its own stock, cost, price and history. To undo, open the product and tap “Split variant out” on a size."],
  },
  {
    title: "Upload a COA",
    where: { label: "Inventory", href: "/admin/inventory" },
    steps: ["Open the product, tap Edit, and go to the Website tab.", "Under “Testing and COAs”, choose the file for the right size and enter the lot number, test date and purity.", "Tap Upload. The new file becomes the current COA and older batches stay listed.", "Set the testing status to “COA available” so the badge and View COA button show on the store."],
  },
  {
    title: "Create a discount code",
    where: { label: "Promotions", href: "/admin/promotions" },
    steps: ["Open Promotions and tap New next to Discount codes.", "Type the code, choose $ or % off, and set any minimum, dates or use limit.", "Save. It works at checkout right away. The list shows how many times it was used and how many uses are left."],
  },
  {
    title: "Change the homepage photo",
    where: { label: "Content", href: "/admin/content?tab=home" },
    steps: ["Open Content. The Home page tab opens first.", "Under Hero, tap Upload (or Replace) and pick the new photo.", "Adjust the overlay if the text is hard to read, then tap Save."],
  },
  {
    title: "Open or close the store",
    where: { label: "Settings", href: "/admin/settings?tab=launch" },
    steps: ["Open Settings. The Launch tab shows whether the store is open and a checklist of what is ready.", "Tap “Open the store” to go live, or “Close the store” to show the Coming soon page.", "While the store is closed you can still preview it: tap Preview store."],
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl pb-10">
      <PageHeader title="Help" sub="Short how-tos for the things you do most." />
      <nav aria-label="On this page" className="mb-6 flex flex-wrap gap-2">
        {HOW_TOS.map((h, i) => (
          <a key={h.title} href={`#how-${i}`} className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-muted transition hover:text-ink">
            {h.title}
          </a>
        ))}
      </nav>
      <div className="space-y-4">
        {HOW_TOS.map((h, i) => (
          <section key={h.title} id={`how-${i}`} className="scroll-mt-20 rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">{h.title}</h2>
              <Link href={h.where.href} className="inline-flex h-10 items-center rounded-xl bg-accent/10 px-3.5 text-sm font-medium text-accent transition hover:bg-accent/15">
                Go to {h.where.label}
              </Link>
            </div>
            <ol className="mt-3 space-y-2.5">
              {h.steps.map((step, n) => (
                <li key={n} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-xs font-semibold tabular-nums text-muted">{n + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
