import Link from "next/link";

export function CategoryPageHeader({ title }: { title: string }) {
  return (
    <header className="px-4 py-4 border-b border-dark-border">
      <div className="max-w-lg mx-auto">
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
