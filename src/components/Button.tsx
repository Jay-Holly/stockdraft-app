import Link from "next/link";
import { type ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
};

const variants = {
  primary:
    "bg-gold text-dark font-bold hover:bg-gold-dark active:scale-[0.98]",
  secondary:
    "bg-primary text-white font-semibold hover:bg-primary-light active:scale-[0.98]",
  ghost:
    "bg-transparent text-white border border-dark-border hover:border-gold/50",
};

export function Button({
  children,
  href,
  type = "button",
  variant = "primary",
  className = "",
  disabled,
  onClick,
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto";

  if (href) {
    return (
      <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
