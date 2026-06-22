type LeagueSupportIdProps = {
  code: string;
  size?: "sm" | "md";
  className?: string;
};

export function LeagueSupportId({
  code,
  size = "sm",
  className = "",
}: LeagueSupportIdProps) {
  const sizeClass =
    size === "md"
      ? "px-2.5 py-1 text-sm"
      : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center rounded-md border border-gold/45 bg-gold/10 font-mono font-bold text-gold tracking-wide ${sizeClass} ${className}`}
      title="League ID — share this with support if you need help"
    >
      {code}
    </span>
  );
}
