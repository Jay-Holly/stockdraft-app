import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <header className="px-4 py-4">
        <Logo />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <ForgotPasswordForm />
      </main>
    </div>
  );
}
