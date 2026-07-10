import Link from "next/link";
import { Logo } from "@/components/Logo";

export function CategoryPageHeader({ title }: { title: string }) {
  return (
    <header className="px-4 py-4 border-b border-dark-border">
      <div className="max-w-lg mx-auto flex items-center justify-between">
        <Logo size="sm" />
        <span className="text-xs text-gold font-semibold uppercase tracking-wider">
          {title}
        </span>
      </div>
      <div className="max-w-lg mx-auto mt-2">
        <Link href="/dashboard" className="text-xs text-muted hover:text-white">
          ← Dashboard
        </Link>
      </div>
    </header>
  );
}
