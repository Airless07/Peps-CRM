// Neutral placeholder shown until a real product photo is uploaded: an original, unbranded vial
// drawing with the product name set on a blank label. Replace it by adding photos in admin.
export function Vial({ name = "", size = "", className }: { name?: string; size?: string; className?: string }) {
  const label = name.length > 13 ? `${name.slice(0, 12).trim()}…` : name;
  return (
    <svg viewBox="0 0 200 250" className={className} role="img" aria-label={name ? `${name} vial (placeholder image)` : "Vial (placeholder image)"}>
      <ellipse cx="100" cy="226" rx="46" ry="6" fill="#000" opacity=".06" />
      {/* cap */}
      <rect x="66" y="26" width="68" height="26" rx="5" fill="var(--s-brand, #9f1d22)" />
      <rect x="66" y="45" width="68" height="7" fill="#000" opacity=".14" />
      <rect x="72" y="52" width="56" height="10" fill="#c9c7c4" />
      {/* neck + body */}
      <path d="M78 62h44v12c0 6 14 10 14 22v112c0 8-6 14-14 14H78c-8 0-14-6-14-14V96c0-12 14-16 14-22z" fill="#fff" stroke="#d9d6d2" strokeWidth="2" />
      <path d="M70 100v104c0 5 3 9 8 9" fill="none" stroke="#fff" strokeWidth="5" opacity=".9" />
      {/* contents */}
      <path d="M66 176h68v32c0 6.600-5.400 12-12 12H78c-6.600 0-12-5.400-12-12z" fill="#f1efec" />
      {/* label */}
      <rect x="64" y="112" width="72" height="62" fill="#fbfaf9" stroke="#e4e1dd" />
      <rect x="64" y="112" width="72" height="5" fill="var(--s-brand, #9f1d22)" />
      {label && (
        <text x="100" y="140" textAnchor="middle" fontSize={label.length > 9 ? 8.5 : 11.5} fontWeight="700" fill="#262220" style={{ letterSpacing: "-0.01em" }}>
          {label}
        </text>
      )}
      {size && (
        <text x="100" y="156" textAnchor="middle" fontSize="8.500" fontWeight="500" fill="#6b6562">
          {size}
        </text>
      )}
      <rect x="82" y="163" width="36" height="1.500" fill="#d9d6d2" />
    </svg>
  );
}
