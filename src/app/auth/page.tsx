import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const isDayTrader = params.mode === "daytrader";
  const mode =
    params.mode === "login" ? "login" : "signup";

  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <header className="px-4 py-4">
        <Logo />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <AuthForm initialMode={mode} variant={isDayTrader ? "daytrader" : "default"} />
      </main>
    </div>
  );
}
