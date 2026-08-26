import Image from "next/image";
import Link from "next/link";

const SHIELD = {
  src: "/images/brand/stockduel-shield-badge.webp",
  width: 333,
  height: 500,
} as const;

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const heights = {
    sm: 32,
    md: 44,
    lg: 64,
  };

  const h = heights[size];
  return (
    <Link href="/" className="inline-flex items-center">
      <Image
        src={SHIELD.src}
        alt="StockDuel"
        width={SHIELD.width}
        height={SHIELD.height}
        priority
        style={{ height: h, width: "auto" }}
      />
    </Link>
  );
}
