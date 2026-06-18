"use client";

import Image from "next/image";
import { useState } from "react";
import { Logo } from "@/components/Logo";

export function StockDraftLogo() {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div className="scale-125 sm:scale-150">
        <Logo size="lg" />
      </div>
    );
  }

  return (
    <Image
      src="/stockdraft-logo.png"
      alt="StockDraft"
      width={320}
      height={140}
      priority
      className="w-[min(280px,75vw)] h-auto mx-auto drop-shadow-[0_0_40px_rgba(255,214,0,0.25)]"
      onError={() => setImgError(true)}
    />
  );
}
