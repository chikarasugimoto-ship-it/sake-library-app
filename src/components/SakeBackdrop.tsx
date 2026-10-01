// アンビエント背景。layout.tsx の {children} の背後に一度だけ敷く。
// 画像/フェッチ/フォント不要。SSR/ISR安全（座標は全てリテラル＝ハイドレーションずれ無し）。
// 2026-10-01: 酒神（神獣）のシルエットをやめ、瓶のシルエットだけにした。
"use client";

import { useEffect, useState } from "react";

/* 瓶パス */
const BOTTLE_VB = "0 0 20 52";
const BOTTLE_D =
  "M8 0h4v4c0 3 1 5 2.5 7 1.6 2.2 2.5 4.5 2.5 8v28a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V19c0-3.5.9-5.8 2.5-8C7 9 8 7 8 4Z";

function BottleSVG({ id }: { id: string }) {
  return (
    <svg viewBox={BOTTLE_VB} width="100%" height="100%" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`skbg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f5d46" />
          <stop offset="100%" stopColor="#1e3d2f" />
        </linearGradient>
      </defs>
      <path d={BOTTLE_D} fill={`url(#skbg-${id})`} />
    </svg>
  );
}

/* 1本＝位置決めした瓶＋リング。瓶だけ低不透明・リングは独立不透明（二重減衰を回避）。 */
function Specimen({ id, size, ring, pos, opacity, anim }: { id: string; size: string; ring: number; pos: React.CSSProperties; opacity: number; anim: boolean }) {
  return (
    <div className={`skb-god${anim ? " is-anim" : ""}`} style={{ width: size, height: size, ...pos }}>
      <div className="skb-ring" style={{ inset: -ring }} />
      <div style={{ width: "100%", height: "100%", opacity }}>
        <BottleSVG id={id} />
      </div>
    </div>
  );
}

const DUST: React.CSSProperties[] = [
  { left: "7%", top: "12%" },
  { left: "90%", top: "20%" },
  { left: "12%", top: "84%" },
  { left: "86%", top: "78%" },
  { left: "50%", top: "6%" },
];

export function SakeBackdrop() {
  // 動きは「reduced-motion でない」かつ「低スペック端末でない」時だけ。
  // useEffect で決めるので SSR マークアップは静止＝ハイドレーション不一致なし。
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowCPU = (navigator.hardwareConcurrency ?? 8) <= 4;
    setAnim(!reduce && !lowCPU);
  }, []);

  return (
    <div className="skb-root" data-skb="home" aria-hidden="true">
      {/* Layer 1 — 後光ハロー（1ノード） */}
      <div className={`skb-halo${anim ? " is-anim" : ""}`} />
      {/* Layer 2 — 瓶のシルエット */}
      <Specimen id="a" size="clamp(360px,88vw,580px)" ring={30} pos={{ left: "-22%", top: "5%" }} opacity={0.1} anim={anim} />
      <Specimen id="b" size="clamp(320px,72vw,500px)" ring={26} pos={{ right: "-24%", bottom: "5%" }} opacity={0.1} anim={anim} />
      {/* Layer 3 — 金粉 */}
      {DUST.map((p, i) => (
        <span key={i} className={`skb-dust${anim ? " is-anim" : ""}`} style={{ ...p, animationDelay: `${i * 1.3}s` }} />
      ))}
      {/* Layer 4 — 可読性ガード */}
      <div className="skb-veil" />
    </div>
  );
}
