import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { settingsUpdate } from "@/lib/schemas";
import { getSettingsRow, toSettings } from "@/lib/serialize";
import { parseContent, parseStore } from "@/lib/store/config";

export const PATCH = route(async (req) => {
  const { store, content, sellButtons, ...data } = await body(req, settingsUpdate);
  await getSettingsRow();
  const row = await prisma.settings.update({
    where: { id: 1 },
    data: {
      ...data,
      ...(sellButtons !== undefined ? { sellButtonsJson: JSON.stringify(sellButtons) } : {}),
      // Round-trip through the parsers so only known, valid shapes are stored.
      ...(store !== undefined ? { storeJson: JSON.stringify(parseStore(store)) } : {}),
      ...(content !== undefined ? { contentJson: JSON.stringify(parseContent(content)) } : {}),
    },
  });
  return { ...toSettings(row), store: parseStore(row.storeJson), content: parseContent(row.contentJson) };
});
