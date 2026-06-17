import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : "login";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <AuthForm initialMode={mode} />
      </main>
    </div>
  );
}
