"use client";

import { useState } from "react";

// 店マスコット「すぎだまる」。/api/mascot（採用画像）を表示。未設定/失敗なら fallback（無ければ何も出さない）。
// variant="advisor" で相談役すぎだまる（眼鏡＋本・自由の女神ポーズ）。
export function Mascot({
  size = 56,
  className = "",
  variant,
  fallback = null,
}: {
  size?: number;
  className?: string;
  variant?: string;
  fallback?: React.ReactNode;
}) {
  const [ok, setOk] = useState(true);
  if (!ok) return <>{fallback}</>;
  const src = variant ? `/api/mascot?variant=${variant}` : "/api/mascot";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="すぎだまる"
      onError={() => setOk(false)}
      className={`shrink-0 rounded-2xl object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// すぎだまる＋吹き出しのセリフ。children に <T ja en/> を渡す。画像が無ければセリフだけ出す。
export function MascotSpeech({
  children,
  size = 52,
  className = "",
  bubble = "card",
}: {
  children: React.ReactNode;
  size?: number;
  className?: string;
  bubble?: "card" | "cream";
}) {
  const [ok, setOk] = useState(true);
  const bg = bubble === "cream" ? "bg-[#f3efe6] text-ink" : "bg-card text-ink";
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/api/mascot"
          alt="すぎだまる"
          onError={() => setOk(false)}
          className="shrink-0 rounded-2xl object-cover shadow-[0_1px_3px_rgba(38,40,43,0.08)]"
          style={{ width: size, height: size }}
        />
      )}
      <div className={`relative flex-1 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[12.5px] leading-relaxed shadow-[0_1px_3px_rgba(38,40,43,0.06)] ${bg}`}>
        {children}
      </div>
    </div>
  );
}
