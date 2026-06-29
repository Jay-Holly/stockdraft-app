import Image from "next/image";
import { StockTickers } from "@/components/StockTickers";
import { LandingActions } from "@/components/LandingActions";
import { createClient } from "@/lib/supabase/server";
import { hasJoinedDayTrader } from "@/lib/profile/day-trader";

const LANDING_HERO_LOGGED_OUT = {
  src: "/images/landing/hero-logged-out.webp",
  width: 1177,
  height: 1337,
} as const;

const LANDING_HERO_LOGGED_IN = {
  src: "/images/landing/hero-logged-in.webp",
  width: 1178,
  height: 1335,
} as const;

const LANDING_HERO_MOBILE_LOGGED_OUT = {
  src: "/images/landing/hero-mobile-logged-out.png",
  width: 852,
  height: 1290,
} as const;

const LANDING_HERO_MOBILE_LOGGED_IN = {
  src: "/images/landing/hero-mobile-logged-in.png",
  width: 852,
  height: 1290,
} as const;

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = Boolean(user);
  const showDayTraderTeaser =
    isLoggedIn && user ? !(await hasJoinedDayTrader(user.id)) : false;
  const hero = isLoggedIn ? LANDING_HERO_LOGGED_IN : LANDING_HERO_LOGGED_OUT;
  const mobileHero = isLoggedIn
    ? LANDING_HERO_MOBILE_LOGGED_IN
    : LANDING_HERO_MOBILE_LOGGED_OUT;
  const heroAlt =
    "StockDraft — Where Fantasy Sports Meet Real Markets. Draft stocks like players. Win your league. Learn the markets. You've never seen a season like this, until now!";

  return (
    <div className="landing-screen">
      <StockTickers />

      <main className="landing-main landing-main--stacked">
        <div className="landing-hero-panel">
          <div className="landing-hero-frame">
            <div className="landing-hero-image-wrap">
              <Image
                src={hero.src}
                alt={heroAlt}
                width={hero.width}
                height={hero.height}
                priority
                className="landing-hero-image landing-hero-image--desktop"
                sizes="(max-width: 767px) 100vw, calc(100vw - 120px)"
              />
              <Image
                src={mobileHero.src}
                alt={heroAlt}
                width={mobileHero.width}
                height={mobileHero.height}
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
