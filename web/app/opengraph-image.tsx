import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Facebook, LinkedIn, Slack and WhatsApp all read this same og:image.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Mehfil — browse and play golden-era Hindi film music";

// Rendered at build time rather than shipped as a static file, so the badge and
// the app's palette stay in step without maintaining a separate artwork file.
export default async function Image() {
  const logo = readFileSync(
    join(process.cwd(), "public", "web-app-manifest-512x512.png")
  );
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 88px",
          background: "linear-gradient(135deg, #1a1613 0%, #241d17 55%, #14110f 100%)",
        }}
      >
        {/* Warm bloom behind the mark, echoing the app's ambient wash. */}
        <div
          style={{
            position: "absolute",
            top: 120,
            left: 40,
            width: 520,
            height: 520,
            borderRadius: 999,
            background: "rgba(214, 168, 84, 0.16)",
            filter: "blur(90px)",
          }}
        />

        <img src={logoSrc} width={300} height={300} style={{ borderRadius: 56 }} />

        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: -3,
              color: "#f5efe6",
              lineHeight: 1,
            }}
          >
            Mehfil
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 34,
              color: "#d6a854",
              letterSpacing: 2,
            }}
          >
            RETRO BOLLYWOOD SONGS
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 28,
              color: "#a89e91",
              lineHeight: 1.4,
              display: "flex",
            }}
          >
            Browse by singer, composer, lyricist, film and mood.
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 34 }}>
            {["3,000+ songs", "66 stations", "Golden era"].map((chip) => (
              <div
                key={chip}
                style={{
                  fontSize: 22,
                  color: "#e8dcc8",
                  border: "1px solid rgba(214,168,84,0.35)",
                  borderRadius: 999,
                  padding: "8px 20px",
                }}
              >
                {chip}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size
  );
}
