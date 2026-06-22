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
          My Leagues
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
        ⚡ Day Trader — Enter Free
      </Link>
      <div className="landing-secondary-links">
        <Link href="/auth?mode=login" className="landing-secondary-link">
          View Demo
        </Link>
        <span className="landing-secondary-divider" aria-hidden="true">
          ·
        </span>
        <Link href="/game-rules" className="landing-secondary-link">
          Game Rules
        </Link>
      </div>
    </nav>
  );
}
