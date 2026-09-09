import { AuthForm } from "@/components/AuthForm";
import { resolveSafeRedirectPath } from "@/lib/auth/redirect-path";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const params = await searchParams;
  const isDayTrader = params.mode === "daytrader";
  const mode =
    params.mode === "login" ? "login" : "signup";
  const redirectTo = resolveSafeRedirectPath(params.next);

  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <AuthForm
          initialMode={mode}
          variant={isDayTrader ? "daytrader" : "default"}
          redirectTo={redirectTo}
        />
      </main>
    </div>
  );
}
