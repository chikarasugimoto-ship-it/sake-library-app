import Image from "next/image";
import { RARITY_META, type Rarity } from "@/lib/sakegami";

// レア度ごとの“動く御神鏡”。手描き不要・全銘柄に自動で付く。中央は実ラベル写真を御姿に。
// 上位ほど後光が速く・金粉が多く・背景が漆黒×金に近づく（賭博性ゼロ＝飲んだ酒に確定で紐づく）。
type Tier = { from: string; to: string; ray: string; spin: string; particles: number; cloud: boolean };
const TIER: Record<Rarity, Tier> = {
  N: { from: "#1b3a2c", to: "#0e2a20", ray: "rgba(185,195,185,0.10)", spin: "40s", particles: 2, cloud: false },
  R: { from: "#1b3d2f", to: "#0b231a", ray: "rgba(159,212,176,0.14)", spin: "32s", particles: 3, cloud: false },
  SR: { from: "#1f4030", to: "#0a1f17", ray: "rgba(202,168,106,0.20)", spin: "24s", particles: 4, cloud: false },
  SSR: { from: "#241c0f", to: "#0c0a06", ray: "rgba(230,207,134,0.26)", spin: "18s", particles: 5, cloud: false },
  UR: { from: "#241c10", to: "#080604", ray: "rgba(240,220,160,0.32)", spin: "13s", particles: 6, cloud: true },
  LR: { from: "#1a140a", to: "#050403", ray: "rgba(243,227,176,0.40)", spin: "10s", particles: 7, cloud: true },
};

export function SakegamiArt({
  rarity,
  color,
  photoUrl,
  artUrl,
  size = 240,
}: {
  rarity: string;
  color: string;
  photoUrl?: string | null;
  artUrl?: string | null; // OpenAI生成のキャラ絵（あれば御姿に優先）
  size?: number;
}) {
  const r = (RARITY_META[rarity as Rarity] ? rarity : "N") as Rarity;
  const t = TIER[r];
  const meta = RARITY_META[r];
  return (
    <div
      className="sg-stage"
      style={{ width: size, height: size, borderRadius: 18, background: `radial-gradient(circle at 50% 45%, ${t.from}, ${t.to})` }}
    >
      <div
        className="sg-rays"
        style={{ background: `repeating-conic-gradient(from 0deg, transparent 0 13deg, ${t.ray} 13deg 15deg)`, animationDuration: t.spin }}
      />
      {t.cloud && (
        <div
          className="sg-rays"
          style={{ inset: "-25%", background: `repeating-conic-gradient(from 7deg, transparent 0 26deg, ${t.ray} 26deg 28deg)`, animationDuration: "17s", animationDirection: "reverse" }}
        />
      )}
      <div className="sg-glow" style={{ borderColor: meta.ring }} />
      <div className="sg-mirror" style={{ border: `3px solid ${meta.color}` }}>
        {/* キャラ絵/ラベル写真は next/image で表示サイズに合わせWebP/AVIF化＋CDNキャッシュ（重いPNGを軽量化） */}
        {artUrl ? (
          <Image src={artUrl} alt="" fill sizes={`${Math.ceil(size * 0.55)}px`} className="sg-photo" />
        ) : photoUrl ? (
          <Image src={photoUrl} alt="" fill sizes={`${Math.ceil(size * 0.55)}px`} className="sg-photo" />
        ) : (
          <div className="sg-bottle" style={{ background: color }} />
        )}
      </div>
      <span className="sg-seal" style={{ color: "#f0dca0", fontSize: Math.round(size * 0.1) }}>
        {meta.jp}
      </span>
      {Array.from({ length: t.particles }).map((_, i) => (
        <span
          key={i}
          className="sg-particle"
          style={{
            left: `${16 + i * (66 / Math.max(1, t.particles))}%`,
            width: r === "N" || r === "R" ? 3 : 4,
            height: r === "N" || r === "R" ? 3 : 4,
            background: meta.ring,
            animationDuration: `${3 + (i % 3)}s`,
            animationDelay: `${i * 0.55}s`,
          }}
        />
      ))}
    </div>
  );
}
