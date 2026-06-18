"use client";

import Image from "next/image";
import { useState } from "react";
import { Logo } from "@/components/Logo";

const LOGO_URL = "https://i.imgur.com/NG4fikb.png";

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
      width={380}
      height={166}
      priority
      unoptimized
      className="w-[min(380px,90vw)] h-auto mx-auto block"
      onError={() => setImgError(true)}
    />
  );
}
