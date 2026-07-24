import Image from "next/image";
import Link from "next/link";
import { StockTickers } from "@/components/StockTickers";
import { PerimeterTicker } from "@/components/PerimeterTicker";
import { LandingActions } from "@/components/LandingActions";
import { createClient } from "@/lib/supabase/server";
import { hasJoinedDayTrader } from "@/lib/profile/day-trader";

const LANDING_HERO_LOGGED_OUT = {
  src: "/images/landing/hero-logged-out.webp",
  width: 1536,
  height: 2752,
} as const;

const LANDING_HERO_LOGGED_IN = {
  src: "/images/landing/hero-logged-in.webp",
  width: 1178,
  height: 1055,
} as const;

const LANDING_HERO_MOBILE_LOGGED_IN = {
  src: "/images/landing/hero-mobile-logged-in.png",
  width: 852,
  height: 1290,
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

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = Boolean(user);
  const showDayTraderTeaser =
    isLoggedIn && user ? !(await hasJoinedDayTrader(user.id)) : false;
  const heroAlt =
    "StockDraft — Where Fantasy Sports Meet Real Markets. Draft stocks like players. Win your league. Learn the markets. You've never seen a season like this, until now!";

  if (!isLoggedIn) {
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

  return (
    <div className="landing-screen">
      <StockTickers />

      <main className="landing-main landing-main--stacked">
        <div className="landing-hero-panel">
          <div className="landing-hero-frame">
            <div className="landing-hero-image-wrap">
              <Image
                src={LANDING_HERO_LOGGED_IN.src}
                alt={heroAlt}
                width={LANDING_HERO_LOGGED_IN.width}
                height={LANDING_HERO_LOGGED_IN.height}
                priority
                className="landing-hero-image landing-hero-image--desktop"
                sizes="(max-width: 767px) 100vw, calc(100vw - 120px)"
              />
              <Image
                src={LANDING_HERO_MOBILE_LOGGED_IN.src}
                alt={heroAlt}
                width={LANDING_HERO_MOBILE_LOGGED_IN.width}
                height={LANDING_HERO_MOBILE_LOGGED_IN.height}
                priority
                className="landing-hero-image landing-hero-image--mobile"
                sizes="100vw"
              />
            </div>
          </div>

          <LandingActions
            isLoggedIn={isLoggedIn}
            showDayTraderTeaser={showDayTraderTeaser}
          />
        </div>
      </main>
    </div>
  );
}
