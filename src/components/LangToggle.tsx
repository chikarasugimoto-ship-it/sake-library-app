"use client";

import { useLang, setLang } from "@/lib/lang";

// 言語切替ボタン。共有ストアを切り替えるだけ（全 <T> が即連動）＋ localStorage に保存。
export function LangToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  return (
    <button
      onClick={() => setLang(lang === "en" ? "ja" : "en")}
      aria-label="Switch language"
      className={`rounded-full border border-hairline bg-card px-2.5 py-1 text-[11px] font-bold text-moss-deep active:scale-95 ${className}`}
    >
      {lang === "en" ? "日本語" : "EN"}
    </button>
  );
}
