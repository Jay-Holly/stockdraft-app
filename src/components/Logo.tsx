import Link from "next/link";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  };

  return (
    <Link href="/" className={`font-black tracking-tight ${sizes[size]}`}>
      <span className="text-gold">Stock</span>
      <span className="text-white">Draft</span>
    </Link>
  );
}
