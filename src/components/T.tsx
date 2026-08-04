"use client";

import type { ReactNode } from "react";
import { useLang } from "@/lib/lang";

// 表示中の言語だけを描画（軽量）。切替時に共有ストア経由で全 <T> が入れ替わる。
// サーバーコンポーネントからも使える（クライアント島として描画される）。en 省略時は ja。
export function T({ ja, en }: { ja: ReactNode; en?: ReactNode }) {
  const lang = useLang();
  return <>{lang === "en" ? en ?? ja : ja}</>;
}
