/**
 * The product's public name, in one place.
 *
 * Page metadata and anything user-facing that is generated rather than written
 * should read from here. Long-form prose (rules pages, modal copy) still spells
 * the name out literally — interpolating a constant through several hundred
 * lines of legal text costs more in readability than it saves in a rename.
 *
 * URL paths, route folder names, cookie keys, database columns and the package
 * name deliberately still say "stockdraft". Those are identifiers, not branding:
 * changing them breaks shared links and stored data and no user ever sees them.
 */
export const APP_NAME = "StockDraft-A-Thon";

export const APP_TAGLINE =
  "The Ultimate Fantasy Sport, All The Time, In Real Time!";

/** Browser tab / OG title. */
export const APP_TITLE = `${APP_NAME} — ${APP_TAGLINE}`;
