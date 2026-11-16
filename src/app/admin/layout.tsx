import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { themeScript } from "@/lib/theme";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "Buckshot Peps admin", template: "%s | Buckshot Peps admin" },
  description: "Orders, inventory and money",
  applicationName: "Buckshot Peps admin",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Peps admin", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-icon" },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f6f3",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="admin">{children}</body>
    </html>
  );
}
