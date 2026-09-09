import { UpdatePasswordForm } from "@/components/UpdatePasswordForm";

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <UpdatePasswordForm />
      </main>
    </div>
  );
}
