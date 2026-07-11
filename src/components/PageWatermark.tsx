import Image from "next/image";

export function PageWatermark({ logoSrc }: { logoSrc?: string | null }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center overflow-hidden"
    >
      {logoSrc ? (
        <Image
          src={logoSrc}
          alt=""
          width={600}
          height={750}
          className="w-[75vw] max-w-[520px] h-auto opacity-[0.05]"
        />
      ) : (
        <span className="text-[26vw] font-black tracking-tight leading-none opacity-[0.03] select-none whitespace-nowrap">
          StockDraft
        </span>
      )}
    </div>
  );
}
