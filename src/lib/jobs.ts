// Background jobs inside the server process (one instance, so a simple timer is enough):
//  - every 3 minutes: cancel unpaid website orders whose time ran out, and send the
//    halfway payment reminder to the ones that still have time
//  - every hour: make today's database backup if it doesn't exist yet
//  - at startup: make sure every product has a parent and every parent has a URL slug
import { ensureDailyBackup } from "./backups";
import { ensureCatalog } from "./catalog-ops";
import { autoCancelDue, sendUnpaidReminders } from "./order-ops";

const g = globalThis as unknown as { __storeJobs?: boolean };

async function safely(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[jobs] ${name} failed:`, e instanceof Error ? e.message : e);
  }
}

export function startJobs() {
  if (g.__storeJobs || process.env.DISABLE_JOBS === "1") return;
  g.__storeJobs = true;
  // Give the server a moment to finish starting (and migrations to be in place).
  setTimeout(() => {
    safely("ensureCatalog", ensureCatalog);
    safely("autoCancel", () => autoCancelDue()).then(() => safely("unpaidReminders", () => sendUnpaidReminders()));
    safely("dailyBackup", () => ensureDailyBackup());
  }, 4000).unref?.();
  setInterval(() => safely("autoCancel", () => autoCancelDue()).then(() => safely("unpaidReminders", () => sendUnpaidReminders())), 3 * 60_000).unref?.();
  setInterval(() => safely("dailyBackup", () => ensureDailyBackup()), 60 * 60_000).unref?.();
}
