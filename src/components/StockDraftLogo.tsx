"use client";

import Image from "next/image";
import { useState } from "react";
import { Logo } from "@/components/Logo";

const LOGO_URL = "https://i.imgur.com/Gy3GSwy.jpeg";

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
      src={LOGO_URL}
      alt="StockDraft"
      width={320}
      height={140}
      priority
      unoptimized
      className="w-[min(280px,75vw)] h-auto mx-auto block"
      onError={() => setImgError(true)}
    />
  );
}
