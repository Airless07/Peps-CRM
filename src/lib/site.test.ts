import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalRedirect, envSiteUrl } from "./site";

const SITE = "https://buckshotlabs.com";

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.PUBLIC_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
});

describe("SITE_URL", () => {
  it("reads SITE_URL, falls back to PUBLIC_URL, drops a trailing slash and any path", () => {
    expect(envSiteUrl()).toBe("");
    process.env.PUBLIC_URL = "https://old.example/";
    expect(envSiteUrl()).toBe("https://old.example");
    process.env.SITE_URL = "https://buckshotlabs.com/";
    expect(envSiteUrl()).toBe(SITE);
    process.env.SITE_URL = "not a url";
    expect(envSiteUrl()).toBe("");
  });

  it("siteUrl() uses SITE_URL over the Settings value and the Railway domain", async () => {
    const { siteUrl } = await import("./order-ops");
    process.env.RAILWAY_PUBLIC_DOMAIN = "buckshotlabs.up.railway.app";
    expect(siteUrl({ siteUrl: "https://buckshotlabs.up.railway.app" })).toBe("https://buckshotlabs.up.railway.app");
    process.env.SITE_URL = SITE;
    expect(siteUrl({ siteUrl: "https://buckshotlabs.up.railway.app" }, "https://other.test")).toBe(SITE);
  });
});

describe("canonicalRedirect", () => {
  it("moves www and railway.app to the site, keeping path and query", () => {
    expect(canonicalRedirect("www.buckshotlabs.com", "/product/retatrutide", "?ref=ABC&x=1", SITE)).toBe("https://buckshotlabs.com/product/retatrutide?ref=ABC&x=1");
    expect(canonicalRedirect("buckshotlabs.up.railway.app", "/admin/orders", "", SITE)).toBe("https://buckshotlabs.com/admin/orders");
    expect(canonicalRedirect("WWW.BuckshotLabs.com:443", "/", "", SITE)).toBe("https://buckshotlabs.com/");
  });

  it("leaves the site itself, localhost, health checks and webhooks alone", () => {
    expect(canonicalRedirect("buckshotlabs.com", "/", "", SITE)).toBeNull();
    expect(canonicalRedirect("localhost:3000", "/", "", SITE)).toBeNull();
    expect(canonicalRedirect("healthcheck.railway.app", "/", "", SITE)).toBeNull();
    expect(canonicalRedirect("buckshotlabs.up.railway.app", "/api/webhooks/shippo", "?key=x", SITE)).toBeNull();
    expect(canonicalRedirect("www.buckshotlabs.com", "/", "", "")).toBeNull();
    expect(canonicalRedirect("www.buckshotlabs.com", "/", "", "http://buckshotlabs.com")).toBeNull();
  });

  it("middleware answers 301 to the site, and accepts same-site API posts on the new domain", async () => {
    process.env.SITE_URL = SITE;
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
    const { middleware } = await import("../middleware");
    const r = await middleware(new NextRequest("https://www.buckshotlabs.com/admin/login?next=%2Fadmin", { headers: { host: "www.buckshotlabs.com" } }));
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://buckshotlabs.com/admin/login?next=%2Fadmin");
    const post = await middleware(new NextRequest("https://buckshotlabs.com/api/store/quote", { method: "POST", headers: { host: "buckshotlabs.com", origin: SITE } }));
    expect(post.status).not.toBe(403);
    const evil = await middleware(new NextRequest("https://buckshotlabs.com/api/store/quote", { method: "POST", headers: { host: "buckshotlabs.com", origin: "https://evil.test" } }));
    expect(evil.status).toBe(403);
    const home = await middleware(new NextRequest("https://buckshotlabs.com/", { headers: { host: "buckshotlabs.com" } }));
    expect(home.status).toBe(200);
  });
});
