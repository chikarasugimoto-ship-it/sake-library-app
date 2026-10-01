import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartBar } from "@/components/CartBar";
import { SakeBackdrop } from "@/components/SakeBackdrop";
// AgeGate（20歳確認ゲート）はオーナー指示で非表示（2026-07-14）。店内QR＝スタッフが対面で年齢確認する運用のため。
// ※未成年飲酒禁止の注記（Zukan/Library等のフッター）は残す。再表示するなら下の <AgeGate/> を戻す。

const SITE_URL = "https://sake-library-plum.vercel.app";
const TITLE = "酒コレ ｜ 煮干しと日本酒 すぎだま";
const DESCRIPTION =
  "東京・常盤橋「煮干しと日本酒 すぎだま」の本日の日本酒。味わいチャートで選んで、お席からそのまま注文。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "酒コレ",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh">
        <SakeBackdrop />
        {children}
        <CartBar />
      </body>
    </html>
  );
}
