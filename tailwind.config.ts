import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surface2: "rgb(var(--surface2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        pos: "rgb(var(--pos) / <alpha-value>)",
        neg: "rgb(var(--neg) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        // Storefront tokens (defined on .store in src/app/(store)/store.css)
        // color-mix lets Tailwind opacity modifiers (bg-night/45) work with CSS variables.
        paper: "color-mix(in srgb, var(--s-bg) calc(<alpha-value> * 100%), transparent)",
        soft: "color-mix(in srgb, var(--s-soft) calc(<alpha-value> * 100%), transparent)",
        coal: "color-mix(in srgb, var(--s-ink) calc(<alpha-value> * 100%), transparent)",
        stone: "color-mix(in srgb, var(--s-muted) calc(<alpha-value> * 100%), transparent)",
        rule: "color-mix(in srgb, var(--s-line) calc(<alpha-value> * 100%), transparent)",
        brand: "color-mix(in srgb, var(--s-brand) calc(<alpha-value> * 100%), transparent)",
        "brand-deep": "color-mix(in srgb, var(--s-brand-deep) calc(<alpha-value> * 100%), transparent)",
        "brand-tint": "color-mix(in srgb, var(--s-brand-tint) calc(<alpha-value> * 100%), transparent)",
        night: "color-mix(in srgb, var(--s-night) calc(<alpha-value> * 100%), transparent)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      opacity: { 8: ".08", 12: ".12" },
      borderRadius: { xl: "14px", "2xl": "18px" },
      maxWidth: { site: "76rem" },
      transitionTimingFunction: { out: "cubic-bezier(.16,1,.3,1)" },
      keyframes: {
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        "drawer-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "rise-in": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "pop-in": { from: { opacity: "0", transform: "scale(.96) translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "0%": { opacity: ".55" }, "50%": { opacity: "1" }, "100%": { opacity: ".55" } },
      },
      animation: {
        marquee: "marquee 38s linear infinite",
        "drawer-in": "drawer-in .42s cubic-bezier(.16,1,.3,1)",
        "rise-in": "rise-in .7s cubic-bezier(.16,1,.3,1) both",
        "sheet-up": "sheet-up .28s cubic-bezier(.2,.8,.2,1)",
        "pop-in": "pop-in .2s cubic-bezier(.2,.8,.2,1)",
        "fade-in": "fade-in .2s ease-out",
        "toast-in": "toast-in .22s cubic-bezier(.2,.8,.2,1)",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
