import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Tests can render server pages (tsconfig keeps JSX as-is for Next.js).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
