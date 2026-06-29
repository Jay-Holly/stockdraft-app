import Link from "next/link";

type LandingActionsProps = {
  isLoggedIn: boolean;
  showDayTraderTeaser: boolean;
};

export function LandingActions({
  isLoggedIn,
  showDayTraderTeaser,
}: LandingActionsProps) {
  if (isLoggedIn) {
    return (
      <nav className="landing-actions" aria-label="Welcome back">
        <Link href="/dashboard" className="landing-btn landing-btn--primary">
          <span className="landing-btn-text landing-btn-text--mobile">
            My Leagues 🔥
          </span>
          <span className="landing-btn-text landing-btn-text--desktop">
            My Leagues
          </span>
        </Link>
        {showDayTraderTeaser && (
          <Link
            href="/day-trader/join"
            className="landing-btn landing-btn--daytrader"
          >
            Play Day Trader — Win Prizes!
          </Link>
        )}
        <div className="landing-secondary-links">
          <Link href="/game-rules" className="landing-secondary-link">
            Game Rules
          </Link>
        </div>
      </nav>
    );
  }

  return (
    <nav className="landing-actions" aria-label="Get started">
      <Link href="/auth" className="landing-btn landing-btn--primary">
        Create Account 🔥
      </Link>
      <Link
        href="/auth?mode=daytrader"
        className="landing-btn landing-btn--daytrader"
      >
        <span className="landing-btn-text landing-btn-text--mobile">
          Play Day Trader — Win Prizes!
        </span>
        <span className="landing-btn-text landing-btn-text--desktop">
          ⚡ Day Trader — Enter Free
        </span>
      </Link>
      <div className="landing-secondary-links">
        <Link
          href="/auth?mode=login"
          className="landing-secondary-link landing-secondary-link--desktop-only"
        >
          View Demo
        </Link>
        <span
          className="landing-secondary-divider landing-secondary-link--desktop-only"
          aria-hidden="true"
        >
          ·
        </span>
        <Link href="/game-rules" className="landing-secondary-link">
          Game Rules
        </Link>
      </div>
    </nav>
  );
}
