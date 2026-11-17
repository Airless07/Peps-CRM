// Security: every admin page and every admin API route refuses a request with no admin session.
// The routes are read from the file system, so a route added later is covered automatically.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

const appDir = path.resolve(import.meta.dirname, "app");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

/** File path to URL: route groups "(x)" vanish, "[id]" becomes a sample value. */
function urlOf(file: string, base: string): string {
  const rel = path.relative(appDir, path.dirname(file)).split(path.sep);
  const parts = rel.filter((p) => !/^\(.*\)$/.test(p)).map((p) => (/^\[\.\.\..+\]$/.test(p) ? "anything/at/all" : /^\[.+\]$/.test(p) ? "sample-id" : p));
  return `${base}/${parts.join("/")}`.replace(/\/+$/, "");
}

const BASE = "https://store.test";
const PUBLIC_API = ["/api/store/", "/api/auth/login", "/api/webhooks/"];
const apiRoutes = walk(path.join(appDir, "api"))
  .filter((f) => /route\.tsx?$/.test(f))
  .map((f) => ({ url: urlOf(f, BASE), methods: [...readFileSync(f, "utf8").matchAll(/export (?:const (?:\{ ?([A-Z, ]+) ?\}|([A-Z]+)) =|async function ([A-Z]+)\()/g)].flatMap((m) => (m[1] ?? m[2] ?? m[3]).split(",").map((x) => x.trim())).filter(Boolean) }));
const adminApi = apiRoutes.filter((r) => !PUBLIC_API.some((p) => new URL(r.url).pathname.startsWith(p) || new URL(r.url).pathname === p.replace(/\/$/, "")));
const publicApi = apiRoutes.filter((r) => !adminApi.includes(r));
const adminPages = walk(path.join(appDir, "admin"))
  .filter((f) => /page\.tsx$/.test(f))
  .map((f) => urlOf(f, BASE))
  .filter((u) => !u.endsWith("/admin/login"));

let middleware: (typeof import("./middleware"))["middleware"];
let createSessionToken: (typeof import("./lib/session"))["createSessionToken"];
let SESSION_COOKIE: string;

beforeAll(async () => {
  ({ middleware } = await import("./middleware"));
  ({ createSessionToken, SESSION_COOKIE } = await import("./lib/session"));
});

const request = (url: string, method = "GET", headers: Record<string, string> = {}) => new NextRequest(url, { method, headers: { host: "store.test", ...headers } });
const sameOrigin = { origin: BASE };

describe("the route lists are complete", () => {
  it("finds the admin pages, admin API routes and public API routes", () => {
    expect(adminPages.length).toBeGreaterThanOrEqual(17);
    expect(adminApi.length).toBeGreaterThanOrEqual(30);
    expect(publicApi.map((r) => new URL(r.url).pathname).sort()).toEqual(
      ["/api/auth/login", "/api/store/account", "/api/store/checkout", "/api/store/contact", "/api/store/lookup", "/api/store/order/sample-id/screenshot", "/api/store/products", "/api/store/quote", "/api/store/review/sample-id", "/api/store/track", "/api/webhooks/shippo"].sort(),
    );
    for (const r of apiRoutes) expect(r.methods.length, r.url).toBeGreaterThan(0);
    // The new admin routes of this pass are in the protected list.
    expect(adminApi.map((r) => new URL(r.url).pathname)).toContain("/api/analytics");
    expect(adminPages.map((u) => new URL(u).pathname)).toContain("/admin/analytics");
  });
});

describe("admin pages need the admin session", () => {
  it.each(adminPages.map((u) => [new URL(u).pathname, u]))("%s redirects to the login page", async (_p, url) => {
    const res = await middleware(request(url));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("an unknown /admin address also redirects (no page content without a session)", async () => {
    const res = await middleware(request(`${BASE}/admin/no-such-page/deeper`));
    expect(res.status).toBe(307);
  });

  it("a forged or expired cookie is refused", async () => {
    for (const bad of ["v1.9999999999999.deadbeef", "v1.1.abc", "garbage", ""]) {
      const res = await middleware(request(`${BASE}/admin/orders`, "GET", { cookie: `${SESSION_COOKIE}=${bad}` }));
      expect(res.status, bad).toBe(307);
    }
  });

  it("the login page and a real session get through", async () => {
    expect((await middleware(request(`${BASE}/admin/login`))).headers.get("x-middleware-next")).toBe("1");
    const { token } = await createSessionToken();
    expect((await middleware(request(`${BASE}/admin/orders`, "GET", { cookie: `${SESSION_COOKIE}=${token}` }))).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("admin API routes need the admin session", () => {
  const cases = adminApi.flatMap((r) => r.methods.map((m) => [m, new URL(r.url).pathname, r.url] as const));

  it.each(cases)("%s %s answers 401 without a session", async (method, _p, url) => {
    const res = await middleware(request(url, method, sameOrigin));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not logged in" });
  });

  it.each(cases.filter(([m]) => m !== "GET"))("%s %s from another site is refused (CSRF)", async (method, _p, url) => {
    const { token } = await createSessionToken();
    const res = await middleware(request(url, method, { origin: "https://evil.example", cookie: `${SESSION_COOKIE}=${token}` }));
    expect(res.status).toBe(403);
  });

  it("every admin route handler also checks the session itself (not only the middleware)", () => {
    for (const f of walk(path.join(appDir, "api")).filter((x) => /route\.tsx?$/.test(x))) {
      const src = readFileSync(f, "utf8");
      const rel = path.relative(appDir, f).split(path.sep).join("/");
      const isPublic = PUBLIC_API.some((p) => `/${rel}`.startsWith(p));
      if (isPublic) continue;
      // Logout only clears the session cookie: it reads and changes no data.
      if (rel === "api/auth/logout/route.ts") {
        expect(src).not.toMatch(/prisma|loadAll/);
        continue;
      }
      // Handlers are built with route() (session check on by default) or the crud helpers that use it.
      expect(/\broute\(|\bcollection\(|\bitem\(/.test(src), rel).toBe(true);
      expect(src.includes("public: true"), `${rel} must not be public`).toBe(false);
    }
  });

  it("a real session gets through", async () => {
    const { token } = await createSessionToken();
    const res = await middleware(request(`${BASE}/api/data`, "GET", { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("public API routes", () => {
  it("are reachable without a session, but state-changing calls must come from this site", async () => {
    for (const r of publicApi) {
      const p = new URL(r.url).pathname;
      for (const m of r.methods) {
        const ok = await middleware(request(r.url, m, sameOrigin));
        expect(ok.headers.get("x-middleware-next"), `${m} ${p}`).toBe("1");
        if (m !== "GET" && !p.startsWith("/api/webhooks/")) {
          const cross = await middleware(request(r.url, m, { origin: "https://evil.example" }));
          expect(cross.status, `${m} ${p} cross-site`).toBe(403);
          const none = await middleware(request(r.url, m));
          expect(none.status, `${m} ${p} no origin`).toBe(403);
        }
      }
    }
  });
});
