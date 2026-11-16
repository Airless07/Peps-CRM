"use client";

// Home page hero visual: three vials in a pyramid. They spread out from the center on load, float
// gently on their own loops, lift apart on hover and follow the mouse a little (desktop only).
// Everything moves with transforms; layout never changes. Styles live in store.css (.hv-*).
import Image from "next/image";
import { useEffect, useRef } from "react";

export interface HeroVialImage {
  src: string;
  /** Uploaded vials are already resized WebP files; the bundled defaults go through next/image. */
  uploaded: boolean;
}

const SLOTS = ["left", "center", "right"] as const;

export function HeroVials({ vials, className = "" }: { vials: Record<(typeof SLOTS)[number], HeroVialImage>; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty("--mx", x.toFixed(3));
      el.style.setProperty("--my", y.toFixed(3));
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const move = (e: PointerEvent) => {
      if (!fine.matches || reduce.matches || e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      queue();
    };
    const leave = () => {
      x = 0;
      y = 0;
      queue();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={`hv ${className}`} aria-hidden>
      <div className="hv-floor" />
      {SLOTS.map((slot) => (
        <div key={slot} className={`hv-slot hv-${slot}`}>
          <div className="hv-in">
            <div className="hv-hover">
              <div className="hv-par">
                <div className="hv-float">
                  <Image
                    src={vials[slot].src}
                    alt=""
                    fill
                    priority
                    unoptimized={vials[slot].uploaded}
                    sizes={slot === "center" ? "(min-width: 1024px) 15vw, 34vw" : "(min-width: 1024px) 12vw, 28vw"}
                    className="hv-img"
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
