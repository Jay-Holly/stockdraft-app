function normalizeOrigin(value: string): string {
  const trimmed = value.replace(/\/$/, "");
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function isLocalhostUrl(value: string): boolean {
  try {
    const host = new URL(normalizeOrigin(value)).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return value.includes("localhost") || value.includes("127.0.0.1");
  }
}

/**
 * Public site origin for invite links and other absolute URLs.
 *
 * Local: set NEXT_PUBLIC_APP_URL=http://localhost:3000 in .env.local
 * Vercel production: set NEXT_PUBLIC_APP_URL=https://stockdraft-app.vercel.app
 * (If unset or mis-set to localhost on Vercel, VERCEL_* vars are used instead.)
 */
export function resolveAppBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(
    /\/$/,
    ""
  );
  const vercelDeployment = process.env.VERCEL_URL?.replace(/\/$/, "");
  const onVercel = Boolean(
    process.env.VERCEL || vercelProduction || vercelDeployment
  );

  if (onVercel) {
    if (explicit && !isLocalhostUrl(explicit)) {
      return normalizeOrigin(explicit);
    }
    if (vercelProduction) {
      return normalizeOrigin(vercelProduction);
    }
    if (vercelDeployment) {
      return `https://${vercelDeployment}`;
    }
  }

  if (explicit) {
    return normalizeOrigin(explicit);
  }

  return "http://localhost:3000";
}
