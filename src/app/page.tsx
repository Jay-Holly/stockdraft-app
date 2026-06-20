import Image from "next/image";
import Link from "next/link";
import { StockTickers } from "@/components/StockTickers";

const LANDING_HERO_URL = "https://i.imgur.com/wYIIeAO.png";

export default function HomePage() {
  return (
    <div className="landing-screen">
      <StockTickers />

      <main className="landing-main">
        <div className="landing-hero-frame">
          <Image
            src={LANDING_HERO_URL}
            alt="StockDraft — Where Fantasy Sports Meet Real Markets. Draft stocks like players. Win your league. Learn the markets. You've never played a season like this, until now!"
            width={1072}
            height={1227}
            priority
            unoptimized
            className="landing-hero-image"
            sizes="calc(100vw - 120px)"
          />

          <nav className="landing-hero-hotspots" aria-label="Get started">
            <Link
              href="/auth"
              className="landing-hotspot landing-hotspot--create"
              aria-label="Create Account"
            />
            <Link
              href="/auth?mode=daytrader"
              className="landing-hotspot landing-hotspot--daytrader"
              aria-label="Day Trader — Enter Free"
            />
            <Link
              href="/auth?mode=login"
              className="landing-hotspot landing-hotspot--demo"
              aria-label="View Demo"
            />
          </nav>
        </div>
      </main>
    </div>
  );
}
