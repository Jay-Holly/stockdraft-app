import Image from "next/image";
import Link from "next/link";
import { PerimeterTicker } from "@/components/PerimeterTicker";
import { APP_TAGLINE } from "@/lib/brand";

// Three pieces of artwork — the headline's two lines and the shield — with
// the tagline and buttons as real markup on top. The buttons are genuine
// links rather than invisible hotspots floated over a picture, so they stay
// put when the art changes and are proper tap targets on a phone.
//
// The headline is an image because its gold-gradient lettering can't be
// reproduced in CSS; the real words are still in the h1 for screen readers
// and search engines, just visually hidden behind it. It's split into two
// files, cropped from the same source, so the top line can be sized
// independently of "Real Markets" without touching that line's pixels.
const HEADLINE_KICKER = {
  src: "/images/brand/stockduel-headline-kicker.webp",
  width: 888,
  height: 155,
} as const;

const HEADLINE_MAIN = {
  src: "/images/brand/stockduel-headline-main.webp",
  width: 1068,
  height: 138,
} as const;

const HERO = {
  src: "/images/brand/stockduel-hero.webp",
  width: 1000,
  height: 1435,
} as const;

export default function HomePage() {
  return (
    <div className="landing-screen sides-always">
      <main className="landing-main landing-main--stacked">
        <div className="landing-hero-panel">
          <div className="landing-hero-frame">
            <PerimeterTicker />

            <div className="landing-hero-content">
              <h1 className="landing-headline">
                <span className="landing-headline-text">
                  Where Fantasy Sports Meet Real Markets
                </span>
                <Image
                  src={HEADLINE_KICKER.src}
                  alt=""
                  width={HEADLINE_KICKER.width}
                  height={HEADLINE_KICKER.height}
                  priority
                  className="landing-headline-kicker-image"
                  sizes="(max-width: 767px) 96vw, min(90vw, 900px)"
                />
                <Image
                  src={HEADLINE_MAIN.src}
                  alt=""
                  width={HEADLINE_MAIN.width}
                  height={HEADLINE_MAIN.height}
                  priority
                  className="landing-headline-main-image"
                  sizes="(max-width: 767px) 96vw, min(90vw, 900px)"
                />
              </h1>

              <div className="landing-shield-stage">
                <Image
                  src={HERO.src}
                  alt={`StockDuel — ${APP_TAGLINE}`}
                  width={HERO.width}
                  height={HERO.height}
                  priority
                  className="landing-shield"
                  sizes="(max-width: 767px) 96vw, min(90vw, 900px)"
                />

                {/* Positioned over the art's own floor area, which starts
                    right where the shield's bottom point ends (~80% down) —
                    not pinned to the image bottom, so the tile floor stays
                    visible around the text and buttons instead of a gap. */}
                <div className="landing-hero-overlay">
                  <p className="landing-tagline">
                    Draft stocks like players. Win your league. Learn the markets.
                    <span className="landing-tagline-kicker">
                      You&rsquo;ve never seen a season like this!
                    </span>
                  </p>

                  <div className="landing-actions">
                    <Link href="/auth" className="landing-btn landing-btn--primary">
                      Create Account
                    </Link>
                    <Link
                      href="/auth?mode=login"
                      className="landing-btn landing-btn--primary"
                    >
                      Sign In
                    </Link>
                    <div className="landing-secondary-links">
                      <Link href="/game-rules" className="landing-secondary-link">
                        HOW TO PLAY
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
