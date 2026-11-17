import type { MetadataRoute } from "next";

/** Installable admin app (the store itself is a normal website). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buckshot Labs admin",
    short_name: "Labs admin",
    description: "Orders, inventory and money",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f3",
    theme_color: "#9f1d22",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
