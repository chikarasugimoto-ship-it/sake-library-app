// 酒神の回廊 — アンビエント背景。layout.tsx の {children} の背後に一度だけ敷く。
// 画像/フェッチ/フォント不要。SSR/ISR安全（座標は全てリテラル＝ハイドレーションずれ無し）。
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Variant = "home" | "detail" | "zukan";

/* アプリ実在の瓶パス（Zukan の BottleSilhouette と同一） */
const BOTTLE_VB = "0 0 20 52";
const BOTTLE_D =
  "M8 0h4v4c0 3 1 5 2.5 7 1.6 2.2 2.5 4.5 2.5 8v28a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V19c0-3.5.9-5.8 2.5-8C7 9 8 7 8 4Z";

/* 手描きのブランドセーフな酒神（御姿）シルエット＝ドーム頭＋やわらかい2本角＋ヒレ胴。
   純粋なパスのみ・アセット不要。背景が「瓶」でなく「キャラ（神獣）」に見えるための核。 */
const GOD_VB = "0 0 120 130";
const GOD_D =
  "M60 6 C70 6 74 14 73 22 C80 16 90 18 90 26 C90 33 82 35 78 34 C92 40 102 56 102 78 C102 106 84 124 60 124 C36 124 18 106 18 78 C18 56 28 40 42 34 C38 35 30 33 30 26 C30 18 40 16 47 22 C46 14 50 6 60 6 Z";

function GodSVG({ kind }: { kind: "god" | "bottle" }) {
  const vb = kind === "god" ? GOD_VB : BOTTLE_VB;
  const d = kind === "god" ? GOD_D : BOTTLE_D;
  return (
    <svg viewBox={vb} width="100%" height="100%" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={`skbg-${kind}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f5d46" />
          <stop offset="100%" stopColor="#1e3d2f" />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#skbg-${kind})`} />
    </svg>
  );
}

/* 1体＝位置決めした御姿＋御神鏡リング。御姿だけ低不透明・リングは独立不透明（二重減衰を回避）。 */
function Specimen({
  kind,
  size,
  ring,
  pos,
  opacity,
  anim,
}: {
  kind: "god" | "bottle";
  size: string; // clamp() の css サイズ
  ring: number; // 御姿の周囲に出すリングの余白px
  pos: React.CSSProperties;
  opacity: number;
  anim: boolean;
}) {
  return (
    <div className={`skb-god${anim ? " is-anim" : ""}`} style={{ width: size, height: size, ...pos }}>
      <div className="skb-ring" style={{ inset: -ring }} />
      <div style={{ width: "100%", height: "100%", opacity }}>
        <GodSVG kind={kind} />
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

export function SakeBackdrop({ variant = "home" }: { variant?: Variant }) {
  // 動きは「reduced-motion でない」かつ「低スペック端末でない」時だけ。
  // useEffect で決めるので SSR マークアップは静止＝ハイドレーション不一致なし。
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowCPU = (navigator.hardwareConcurrency ?? 8) <= 4;
    setAnim(!reduce && !lowCPU);
  }, []);

  const detail = variant === "detail";
  const zukan = variant === "zukan";

  return (
    <div className="skb-root" data-skb={variant} aria-hidden="true">
      {/* Layer 1 — 後光ハロー（1ノード） */}
      <div className={`skb-halo${anim ? " is-anim" : ""}`} />

      {/* Layer 2 — 御姿（神獣）。detail は1体だけ・低く・淡く。 */}
      {detail ? (
        <Specimen kind="god" size="clamp(320px,80vw,520px)" ring={26} pos={{ left: "-30%", bottom: "8%" }} opacity={0.05} anim={anim} />
      ) : (
        <>
          <Specimen kind="god" size="clamp(360px,88vw,580px)" ring={30} pos={{ left: "-22%", top: zukan ? "28%" : "5%" }} opacity={0.13} anim={anim} />
          <Specimen kind="bottle" size="clamp(320px,72vw,500px)" ring={26} pos={{ right: "-24%", bottom: zukan ? "2%" : "5%" }} opacity={0.1} anim={anim} />
        </>
      )}

      {/* Layer 3 — 金粉（混み合う zukan と暗いカードの detail では出さない） */}
      {!detail && !zukan &&
        DUST.map((p, i) => (
          <span key={i} className={`skb-dust${anim ? " is-anim" : ""}`} style={{ ...p, animationDelay: `${i * 1.3}s` }} />
        ))}

      {/* Layer 4 — 可読性ガード */}
      <div className="skb-veil" />
    </div>
  );
}

// ルートに応じて variant を切替（client・装飾のみ。ページ本体は ISR のまま静的）。
export function RoutedBackdrop() {
  const p = usePathname() || "/";
  const variant: Variant = p.startsWith("/sake/") ? "detail" : p === "/zukan" ? "zukan" : "home";
  return <SakeBackdrop variant={variant} />;
}
