import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Content Security Policy. Next.js needs inline scripts/styles for hydration; everything else is same-origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: noindex },
      { source: "/admin", headers: noindex },
      { source: "/api/:path*", headers: noindex },
      { source: "/order/:path*", headers: noindex },
      { source: "/review/:path*", headers: noindex },
    ];
  },
  // Old admin addresses (from before the store) keep working: they now live under /admin.
  async redirects() {
    const moved: [string, string][] = [
      ["/login", "/admin/login"],
      ["/orders", "/admin/orders"],
      ["/inventory", "/admin/inventory"],
      ["/customers", "/admin/customers"],
      ["/money", "/admin/money"],
      ["/pay", "/admin/pay"],
      ["/settings", "/admin/settings"],
    ];
    return moved.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
};

export default nextConfig;
