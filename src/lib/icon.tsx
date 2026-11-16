import { ImageResponse } from "next/og";

/** App icon drawn at any size: a vial on a deep red tile. */
export function appIcon(size: number) {
  const s = size / 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#9f1d22",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 150 * s, height: 44 * s, borderRadius: 14 * s, background: "#ffffff" }} />
          <div
            style={{
              marginTop: 14 * s,
              width: 124 * s,
              height: 230 * s,
              borderRadius: `${18 * s}px ${18 * s}px ${50 * s}px ${50 * s}px`,
              border: `${16 * s}px solid #ffffff`,
              display: "flex",
              alignItems: "flex-end",
              overflow: "hidden",
            }}
          >
            <div style={{ width: "100%", height: 110 * s, background: "#f1c4c6" }} />
          </div>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
