import Image from "next/image";
import Link from "next/link";
import { PerimeterTicker } from "@/components/PerimeterTicker";

const LANDING_HERO_LOGGED_OUT = {
  src: "/images/landing/hero-logged-out.webp",
  width: 1536,
  height: 2752,
} as const;

// Percent-based hit zones matching the buttons drawn into
// hero-logged-out.webp (1536x2752). Recompute these if that image changes.
const LOGGED_OUT_HOTSPOTS = [
  {
    href: "/auth",
    label: "Create Account",
    style: { left: "21.3%", right: "20.1%", top: "81.4%", height: "3.5%" },
  },
  {
    href: "/auth?mode=login",
    label: "Sign In",
    style: { left: "21.3%", right: "20.1%", top: "87.1%", height: "3.6%" },
  },
  {
    href: "/game-rules",
    label: "How to Play",
    style: { left: "39.1%", right: "38.8%", top: "94.7%", height: "2.2%" },
  },
] as const;

export default function HomePage() {
  const heroAlt =
    "StockDraft — Where Fantasy Sports Meet Real Markets. Draft stocks like players. Win your league. Learn the markets. You've never seen a season like this, until now!";

  return (
    <div className="landing-screen sides-always">
      <main className="landing-main landing-main--stacked">
        <div className="landing-hero-panel">
          <div className="landing-hero-frame">
            <PerimeterTicker />
            <div className="landing-hero-image-wrap" style={{ position: "relative" }}>
              <Image
                src={LANDING_HERO_LOGGED_OUT.src}
                alt={heroAlt}
                width={LANDING_HERO_LOGGED_OUT.width}
                height={LANDING_HERO_LOGGED_OUT.height}
                priority
                className="landing-hero-image"
                sizes="(max-width: 767px) 100vw, calc(100vw - 120px)"
              />
              {LOGGED_OUT_HOTSPOTS.map((hotspot) => (
                <Link
                  key={hotspot.href}
                  href={hotspot.href}
                  aria-label={hotspot.label}
                  style={{ position: "absolute", ...hotspot.style }}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
