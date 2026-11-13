import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { settingsUpdate } from "@/lib/schemas";
import { getSettingsRow, toSettings } from "@/lib/serialize";

export const PATCH = route(async (req) => {
  const data = await body(req, settingsUpdate);
  await getSettingsRow();
  return toSettings(await prisma.settings.update({ where: { id: 1 }, data }));
});
