import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_TITLE } from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_TITLE,
  description:
    "Draft stocks like players. Win your league. Learn the markets. You've never seen a season like this.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0a06",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
