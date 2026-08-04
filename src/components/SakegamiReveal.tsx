"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { RARITY_META, rarityRank, type Rarity } from "@/lib/sakegami";
import { T } from "@/components/T";
import { Mascot } from "@/components/Mascot";
import { haptic } from "@/lib/haptics";
import { RevealFx } from "@/lib/reveal-particles";

const MINCHO = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";

// ============================================================================
// 「神おろし」六段之格 — 格は派手さの足し算ではなく【演出言語の段階的解放】で語る。
//   N  = 光ひとつ（常夜灯・固定カメラ・完全な静謐）
//   R  = カメラが動く（ドリーイン・金のワイプ・リムライト）
//   SR = 時間に緩急が生まれる（溜め→一閃→附け打ち→見得の静止）
//   SSR= 時間が伸びる（金粉の天候・スローモーション・闇からの開帳）
//   UR = 天候が介入する（シネスコ黒帯・注連縄の結界・雷・すぎだまる平伏）
//   LR = 世界が作り替えられる（柝と定式幕・全消灯→開眼・漆黒×金×虹）
// 実装規約（過去の全画面フラッシュ事故の構造的根絶）:
//   - animation はクラス .fxa の【longhandのみ】で指定し、時間は CSS変数(--n/--d/--dur)で渡す
//     ＝インライン animation 短縮記法による fill-mode リセットを廃絶。
//   - 一過性エフェクトは例外なく .ko-fx ＋ 終端キーフレーム opacity:0。
//   - filter はアニメしない（grayscale/黒カバーの静的レイヤーを opacity クロスフェード）。
// 互換: props(name, rarity, artUrl, extra, onClose)・2段階タップ（演出中=完成形へスキップ／
//   完成後=閉じる）・自動クローズ・prefers-reduced-motion は従来どおり。
// ============================================================================

type Beat = { at: number; run: (fx: RevealFx | null, root: HTMLElement | null) => void };

type Script = {
  dur: number;          // 自動クローズ(秒)
  finishedAt: number;   // 完成（以降タップで閉じる）(秒)
  canvas: boolean;      // パーティクル層を使うか（SSR以上）
  bg: string;           // 背景
  vignette: number;     // 周辺減光の強さ 0..1
  rings: { at: number; color: string }[]; // 鈴の宣（輪の本数と色で格を宣言）
  charAt: number; charStep: number; charHit: boolean;
  frameAt: number;
  grayAt?: number; grayDur?: number;        // 墨→色（N/R）
  coverAt?: number; coverDur?: number;      // 黒からの開帳（SSR/UR/LR）
  splitAt?: number;                          // 斬られて割れる（SR）
  wipeAt?: number;                           // 金のワイプ（R）
  slashAt?: number;                          // 一閃（SR）
  tsukeAts: number[];                        // 附け打ち（白2連＋ジャーク）
  flashAts: { at: number; dur: number; color: string; max: number }[];
  dipAt?: number; dipDur?: number;           // 溜め・静寂（浅い暗転）
  deepAt?: number; deepDur?: number;         // 全消灯（LR）
  lidAt?: number;                            // 開眼のまぶた（LR）
  eyelineAt?: number;                        // 開眼の金一線（LR）
  shockAts: { at: number; color: string }[];
  raysAt?: number; raysOp: number; raysDouble?: boolean;
  backlightAt?: number;                      // シルエット逆光（SSR）
  lantern?: boolean;                          // 常夜灯（N/R）
  rimAt?: number;                             // リムライト定常点灯
  aberrAt?: number;                           // 色収差（UR）
  sealAt: number; sealSlam: boolean;
  blessAt: number; bless2At?: number;         // LRは二段
  mascot?: { at: number; pos: "right" | "center"; size: number };
  bars?: boolean;                             // シネスコ黒帯（UR/LR）
  shimenawaAt?: number;                       // 注連縄（UR）
  curtain?: boolean;                          // 定式幕（LR）
  kiAt?: number;                              // 柝三打（LR）
  rainbow?: boolean;                          // 虹のヘアライン＋虹輪（LR）
  tagAt?: number;                             // 金の木札「伝説」（LR）
  dolly?: { name: string; at: number; dur: number };
  punch?: { name: string; at: number; dur: number };
  jerkAts: number[];
  shakeAt?: number;
  wobble?: boolean;                           // 手持ち揺れ（UR）
  beats: Beat[];
  blessJa: string; blessEn: string;
};

const C = { x: 0.5, y: 0.42 }; // 額の中心（正規化）

function slowMo(root: HTMLElement | null, fx: RevealFx | null, rate: number, realMs: number) {
  const anims: Animation[] = [];
  root?.querySelectorAll("[data-slow]").forEach((el) => {
    try { anims.push(...(el as HTMLElement).getAnimations()); } catch { /* 非対応は無視 */ }
  });
  anims.forEach((a) => { try { a.playbackRate = rate; } catch { /* noop */ } });
  if (fx) fx.timeScale = rate;
  window.setTimeout(() => {
    anims.forEach((a) => { try { a.playbackRate = 1; } catch { /* noop */ } });
    if (fx) fx.timeScale = 1;
  }, realMs);
}

const SCRIPTS: Record<Rarity, Script> = {
  // ---- N 常夜灯: 唯一「光らない」。静謐が上位全階級の落差の原資 ----
  N: {
    dur: 10, finishedAt: 3.2, canvas: false,
    bg: "radial-gradient(circle at 50% 42%, #22281f 0%, #0a0f0b 60%, #060906 100%)",
    vignette: 0.35,
    rings: [{ at: 0.15, color: "#bcd9c5" }],
    charAt: 0.4, charStep: 0.08, charHit: false,
    frameAt: 0.6, grayAt: 1.2, grayDur: 1.0,
    tsukeAts: [], flashAts: [], shockAts: [], jerkAts: [],
    raysOp: 0, lantern: true,
    sealAt: 2.7, sealSlam: false, blessAt: 3.0,
    beats: [{ at: 2.7, run: () => haptic([0, 24]) }],
    blessJa: "一柱、宿りました。", blessEn: "A god now dwells with you.",
  },
  // ---- R 蔵の灯: カメラが初めて動く ----
  R: {
    dur: 12, finishedAt: 3.8, canvas: false,
    bg: "radial-gradient(circle at 50% 42%, #1c2b20 0%, #0a100b 60%, #050805 100%)",
    vignette: 0.4,
    rings: [{ at: 0.15, color: "#bcd9c5" }],
    charAt: 0.4, charStep: 0.08, charHit: false,
    frameAt: 1.0, grayAt: 1.7, grayDur: 0.8, wipeAt: 1.6,
    tsukeAts: [], flashAts: [], jerkAts: [],
    shockAts: [{ at: 2.4, color: "#4f7a5c" }],
    raysOp: 0, lantern: true, rimAt: 2.2,
    dolly: { name: "ko-dolly-r", at: 0.8, dur: 4 },
    sealAt: 2.9, sealSlam: false, blessAt: 3.4,
    beats: [{ at: 2.9, run: () => haptic([0, 28, 20, 30]) }],
    blessJa: "よき神に、会えましたね。", blessEn: "A fine god has come to you.",
  },
  // ---- SR 匠の一閃: 溜めて、斬る、見得で止まる ----
  SR: {
    dur: 14, finishedAt: 4.6, canvas: false,
    bg: "radial-gradient(circle at 50% 42%, #241b10 0%, #0c0906 60%, #060504 100%)",
    vignette: 0.5,
    rings: [{ at: 0.15, color: "#a8702f" }, { at: 0.37, color: "#a8702f" }],
    charAt: 0.3, charStep: 0.05, charHit: true,
    frameAt: 1.0, splitAt: 1.95, slashAt: 1.9,
    dipAt: 1.6, dipDur: 0.7,
    tsukeAts: [1.95],
    flashAts: [],
    shockAts: [{ at: 2.2, color: "#a8702f" }],
    jerkAts: [1.95],
    raysAt: 2.4, raysOp: 0.12,
    dolly: { name: "ko-dolly-sr", at: 1.0, dur: 3 },
    punch: { name: "ko-punch-sr", at: 1.9, dur: 1.5 },
    sealAt: 3.1, sealSlam: false, blessAt: 3.8,
    beats: [
      { at: 1.9, run: () => haptic([0, 18]) },
      { at: 3.1, run: () => haptic([0, 30, 30, 40]) },
    ],
    blessJa: "匠の一柱、あなたの社へ。", blessEn: "A master god joins your shrine.",
  },
  // ---- SSR 金風後光: 時間が伸び、逆光が明ける ----
  SSR: {
    dur: 17, finishedAt: 5.4, canvas: true,
    bg: "radial-gradient(circle at 50% 42%, #2a2412 0%, #0c0a05 60%, #060503 100%)",
    vignette: 0.55,
    rings: [{ at: 0.1, color: "#e6cf86" }, { at: 0.32, color: "#e6cf86" }, { at: 0.54, color: "#e6cf86" }],
    charAt: 0.4, charStep: 0.06, charHit: false,
    frameAt: 1.0, coverAt: 2.7, coverDur: 0.45, backlightAt: 1.8,
    tsukeAts: [2.7, 2.95],
    flashAts: [{ at: 2.7, dur: 0.5, color: "#fffdf4", max: 0.85 }],
    shockAts: [{ at: 3.1, color: "#b8923a" }, { at: 3.34, color: "#e6cf86" }],
    jerkAts: [2.7],
    raysAt: 2.2, raysOp: 0.3,
    dolly: { name: "ko-dolly-ssr", at: 1.2, dur: 3.5 },
    punch: { name: "ko-punch-ssr", at: 2.7, dur: 1.8 },
    sealAt: 4.0, sealSlam: false, blessAt: 4.6,
    beats: [
      { at: 0, run: (fx) => { fx?.addEmitter({ kind: "dust", rate: 20, y: [0.85, 1.05], speed: [0.02, 0.05], ttl: [3, 5], size: [2, 5], gravity: -0.006, sway: 0.02 }); } },
      { at: 2.2, run: (fx, root) => { slowMo(root, fx, 0.25, 500); fx?.burst({ kind: "dust", count: 90, x: C.x, y: C.y, speed: [0.05, 0.22], ttl: [1.2, 2.4], size: [2, 6], gravity: -0.02, drag: 0.94, swirl: 2.2 }); } },
      { at: 2.7, run: (fx) => { haptic([0, 40, 35, 60]); fx?.burst({ kind: "spark", count: 24, x: C.x, y: C.y, speed: [0.15, 0.4], ttl: [0.5, 1.0], size: [1.5, 3.5], gravity: 0.1, drag: 0.9 }); } },
      { at: 5.4, run: (fx) => { fx?.clearEmitters(); fx?.addEmitter({ kind: "dust", rate: 8, y: [0.9, 1.05], speed: [0.015, 0.04], ttl: [3, 5], size: [2, 4], gravity: -0.005, sway: 0.02 }); } },
    ],
    blessJa: "めったに現れぬ神。今宵は、佳い夜。", blessEn: "A rare god has shown itself. A fine night indeed.",
  },
  // ---- UR 雷鳴天啓: 注連縄の結界・雷・すぎだまる平伏 ----
  UR: {
    dur: 20, finishedAt: 6.4, canvas: true,
    bg: "radial-gradient(circle at 50% 42%, #14110a 0%, #070604 55%, #030302 100%)",
    vignette: 0.7,
    rings: [{ at: 0.12, color: "#e6cf86" }, { at: 0.3, color: "#c34a2e" }],
    charAt: 0.8, charStep: 0.06, charHit: false,
    frameAt: 1.2, coverAt: 3.3, coverDur: 0.4,
    dipAt: 2.0, dipDur: 0.5,
    tsukeAts: [2.4, 2.55],
    flashAts: [{ at: 2.4, dur: 0.24, color: "#ffffff", max: 0.85 }, { at: 2.8, dur: 0.3, color: "#fdf8ec", max: 0.7 }],
    shockAts: [{ at: 3.3, color: "#9a7b1f" }, { at: 3.5, color: "#e6cf86" }, { at: 3.72, color: "#c34a2e" }],
    jerkAts: [],
    raysAt: 3.3, raysOp: 0.35, raysDouble: true,
    aberrAt: 2.4,
    dolly: { name: "ko-dolly-ur", at: 1.4, dur: 3 },
    punch: { name: "ko-punch-ur", at: 2.4, dur: 2.6 },
    shakeAt: 2.4, wobble: true,
    bars: true, shimenawaAt: 0.5,
    mascot: { at: 4.6, pos: "right", size: 42 },
    sealAt: 5.1, sealSlam: true, blessAt: 5.7,
    beats: [
      { at: 1.4, run: (fx) => { fx?.addEmitter({ kind: "ember", rate: 15, y: [0.95, 1.08], speed: [0.03, 0.08], ttl: [2.5, 4], size: [1.5, 4], gravity: -0.01, sway: 0.03 }); } },
      { at: 2.4, run: (fx) => { haptic([0, 35]); fx?.bolt(0.5, -0.02, 0.5, 0.33, 2.2); } },
      { at: 2.8, run: (fx, root) => { fx?.bolt(0.4, -0.02, 0.52, 0.35, 3.4, 0.18); slowMo(root, fx, 0.2, 420); } },
      { at: 3.3, run: (fx) => { haptic([0, 50, 40, 90]); fx?.burst({ kind: "ember", count: 80, x: C.x, y: C.y, speed: [0.06, 0.28], ttl: [1, 2.2], size: [1.5, 4], gravity: -0.02, drag: 0.93, swirl: 2.8 }); fx?.burst({ kind: "spark", count: 30, x: C.x, y: C.y, speed: [0.2, 0.5], ttl: [0.4, 0.9], size: [1.5, 3], gravity: 0.12, drag: 0.9 }); } },
    ],
    blessJa: "——稀なる一柱。社が、ざわめいています。", blessEn: "— A god of rare rank. Your shrine stirs.",
  },
  // ---- LR 大神事・虹暁の開眼: 世界が一度終わって作り直される ----
  LR: {
    dur: 24, finishedAt: 7.6, canvas: true,
    bg: "#030303",
    vignette: 0.75,
    rings: [],
    charAt: 2.6, charStep: 0.09, charHit: true,
    frameAt: 3.0, coverAt: 5.3, coverDur: 0.5,
    deepAt: 4.2, deepDur: 1.4, lidAt: 4.6, eyelineAt: 5.15,
    tsukeAts: [5.6, 5.78],
    flashAts: [{ at: 5.6, dur: 0.3, color: "#fffef8", max: 0.9 }],
    shockAts: [{ at: 5.7, color: "#d8b85a" }, { at: 5.92, color: "#e6cf86" }, { at: 6.14, color: "#9b2d20" }],
    jerkAts: [],
    raysAt: 5.6, raysOp: 0.35, raysDouble: true,
    dolly: { name: "ko-dolly-lr", at: 3.2, dur: 3 },
    punch: { name: "ko-punch-lr", at: 5.6, dur: 2.2 },
    shakeAt: 5.6,
    bars: true, curtain: true, kiAt: 0, rainbow: true,
    mascot: { at: 3.6, pos: "center", size: 56 },
    tagAt: 7.0,
    sealAt: 7.1, sealSlam: true, blessAt: 6.3, bless2At: 7.4,
    beats: [
      { at: 1.6, run: (fx) => { fx?.setAurora(true); fx?.addEmitter({ kind: "dust", rate: 10, y: [0.85, 1.05], speed: [0.015, 0.05], ttl: [3, 6], size: [1.5, 4], gravity: -0.005, sway: 0.02 }); } },
      { at: 2.7, run: (fx) => { fx?.burst({ kind: "leaf", count: 14, x: 0.5, y: 0.24, speed: [0.02, 0.1], ttl: [1.5, 2.8], size: [2, 5], gravity: 0.03, drag: 0.98 }); } },
      { at: 4.9, run: (fx, root) => { slowMo(root, fx, 0.15, 800); fx?.burst({ kind: "leaf", count: 150, x: C.x, y: C.y, speed: [0.04, 0.24], ttl: [1.5, 3.2], size: [2, 6], gravity: 0.015, drag: 0.965, swirl: 2.4 }); } },
      { at: 5.7, run: (fx) => { haptic([0, 60, 50, 110, 50, 60]); fx?.burst({ kind: "dust", count: 70, x: C.x, y: C.y, speed: [0.15, 0.45], ttl: [0.8, 1.8], size: [2, 5], gravity: 0.02, drag: 0.92 }); } },
      { at: 8.0, run: (fx) => { fx?.clearEmitters(); fx?.addEmitter({ kind: "leaf", rate: 6, y: [-0.08, -0.02], angle: [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3], speed: [0.02, 0.06], ttl: [4, 7], size: [2, 5], gravity: 0.01, drag: 1, sway: 0.03 }); } },
    ],
    blessJa: "これは……っ。", blessEn: "This is—…",
  },
};

// CSS変数でアニメを注入するヘルパ（animation短縮記法は使わない＝fill-modeリセット根絶）
const va = (n: string, d: number, dur: number, e?: string, ic?: string): React.CSSProperties =>
  ({ "--n": n, "--d": `${d}s`, "--dur": `${dur}s`, ...(e ? { "--e": e } : {}), ...(ic ? { "--ic": ic } : {}) }) as React.CSSProperties;

export function SakegamiReveal({
  name,
  rarity,
  artUrl,
  extra = 0,
  onClose,
}: {
  name: string;
  rarity: string;
  artUrl?: string | null;
  extra?: number;
  onClose: () => void;
}) {
  const m = RARITY_META[rarity as Rarity] || RARITY_META.N;
  const rank = rarityRank(rarity as Rarity);
  const s = SCRIPTS[rarity as Rarity] || SCRIPTS.N;
  const chars = [...(name || "酒神")].slice(0, 12);
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<RevealFx | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (s.canvas && !reduced && canvasRef.current) {
      try { fxRef.current = new RevealFx(canvasRef.current); } catch { fxRef.current = null; }
    }
    const timers = timersRef.current;
    if (!reduced) {
      for (const b of s.beats) timers.push(window.setTimeout(() => b.run(fxRef.current, rootRef.current), b.at * 1000));
    }
    timers.push(window.setTimeout(() => setFinished(true), s.finishedAt * 1000));
    timers.push(window.setTimeout(onClose, s.dur * 1000));
    return () => {
      // スキップ時に timersRef.current は新配列へ差し替わるため、捕捉した timers ではなく
      // 実行時点の ref を掃除する（さもないとスキップ後の自動クローズタイマーが残り onClose 二重発火）
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      fxRef.current?.destroy();
      fxRef.current = null;
    };
    // 演出は初回マウントの一発もの（rarityごとに親がkey替えで再マウントする前提）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTap() {
    if (!finished) {
      // 完成形へスキップ: CSSは.ko-skipが終端へ、canvasは全消去、残りの鼓動系ビートは止める
      setSkipped(true);
      setFinished(true);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [window.setTimeout(onClose, (s.dur - s.finishedAt) * 1000)];
      const fx = fxRef.current;
      if (fx) { fx.timeScale = 1; fx.clearAll(); }
      rootRef.current?.querySelectorAll("[data-slow]").forEach((el) => {
        try { (el as HTMLElement).getAnimations().forEach((a) => { a.playbackRate = 1; }); } catch { /* noop */ }
      });
    } else {
      onClose();
    }
  }

  const frameW = 224, frameH = 280;

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden${skipped ? " ko-skip" : ""}`}
      style={{ background: s.bg }}
      onClick={handleTap}
    >
      <style>{`
        /* ===== アニメ注入クラス（longhandのみ＝fill-modeが絶対に消えない） ===== */
        .fxa {
          animation-name: var(--n, none);
          animation-duration: var(--dur, 1s);
          animation-timing-function: var(--e, ease);
          animation-delay: var(--d, 0s);
          animation-iteration-count: var(--ic, 1);
          animation-fill-mode: both;
        }
        /* ===== キーフレーム（一過性=.ko-fxは必ず終端opacity:0） ===== */
        @keyframes ko-ring { 0% { opacity:0; transform:translate(-50%,-50%) scale(.2) } 25% { opacity:.8 } 100% { opacity:0; transform:translate(-50%,-50%) scale(2.4) } }
        @keyframes ko-char { 0% { opacity:0; transform:translateY(10px) } 100% { opacity:1; transform:none } }
        @keyframes ko-char-hit { 0% { opacity:0; transform:scale(1.7) } 60% { opacity:1; transform:scale(.96) } 100% { opacity:1; transform:scale(1) } }
        @keyframes ko-frame { 0% { opacity:0; transform:translateY(14px) scale(.92) } 100% { opacity:1; transform:none } }
        @keyframes ko-fadeout { 0% { opacity:1 } 100% { opacity:0 } }
        @keyframes ko-fadein { 0% { opacity:0 } 100% { opacity:1 } }
        @keyframes ko-split-t { 0% { opacity:1; transform:none } 100% { opacity:0; transform:translateY(-20px) } }
        @keyframes ko-split-b { 0% { opacity:1; transform:none } 100% { opacity:0; transform:translateY(20px) } }
        @keyframes ko-wipe { 0% { opacity:0; transform:translate(-70vw,-40vh) rotate(45deg) } 20% { opacity:1 } 100% { opacity:0; transform:translate(70vw,40vh) rotate(45deg) } }
        @keyframes ko-slash { 0% { opacity:0; transform:translateX(-130vw) rotate(-24deg) } 12% { opacity:1 } 88% { opacity:1 } 100% { opacity:0; transform:translateX(130vw) rotate(-24deg) } }
        @keyframes ko-tsuke { 0% { opacity:0 } 12% { opacity:.42 } 26% { opacity:0 } 48% { opacity:.46 } 66% { opacity:0 } 100% { opacity:0 } }
        @keyframes ko-flash { 0% { opacity:0 } 14% { opacity:var(--fmax,.85) } 100% { opacity:0 } }
        @keyframes ko-fadein-half { 0% { opacity:0 } 100% { opacity:.5 } }
        @keyframes ko-dip { 0% { opacity:0 } 30% { opacity:.42 } 78% { opacity:.42 } 100% { opacity:0 } }
        @keyframes ko-deep { 0% { opacity:0 } 18% { opacity:.96 } 46% { opacity:.9 } 60% { opacity:.97 } 84% { opacity:.94 } 100% { opacity:0 } }
        @keyframes ko-lid-t { 0% { opacity:0; transform:none } 16% { opacity:1 } 58% { opacity:1; transform:none } 100% { opacity:0; transform:translateY(-104%) } }
        @keyframes ko-lid-b { 0% { opacity:0; transform:none } 16% { opacity:1 } 58% { opacity:1; transform:none } 100% { opacity:0; transform:translateY(104%) } }
        @keyframes ko-eyeline { 0% { opacity:0; transform:scaleY(.02) } 35% { opacity:1; transform:scaleY(1) } 100% { opacity:0; transform:scaleY(.4) } }
        @keyframes ko-shock { 0% { opacity:0; transform:translate(-50%,-50%) scale(.25) } 12% { opacity:.9 } 100% { opacity:0; transform:translate(-50%,-50%) scale(2.7) } }
        @keyframes ko-aberr-r { 0% { opacity:0; transform:translateX(0) } 20% { opacity:.4; transform:translateX(5px) } 100% { opacity:0; transform:translateX(0) } }
        @keyframes ko-aberr-c { 0% { opacity:0; transform:translateX(0) } 20% { opacity:.4; transform:translateX(-5px) } 100% { opacity:0; transform:translateX(0) } }
        @keyframes ko-backlight { 0% { opacity:0 } 45% { opacity:.75 } 75% { opacity:.75 } 100% { opacity:0 } }
        @keyframes ko-rot { 0% { transform:rotate(0) } 100% { transform:rotate(360deg) } }
        @keyframes ko-rot-rev { 0% { transform:rotate(0) } 100% { transform:rotate(-360deg) } }
        @keyframes ko-lantern { 0%,100% { opacity:.22 } 50% { opacity:.4 } }
        @keyframes ko-seal { 0% { opacity:0; transform:scale(2.6) rotate(-14deg) } 55% { opacity:1; transform:scale(.9) rotate(3deg) } 78% { transform:scale(1.06) rotate(-1deg) } 100% { opacity:1; transform:scale(1) rotate(0) } }
        @keyframes ko-rise { 0% { opacity:0; transform:translateY(12px) } 100% { opacity:1; transform:none } }
        @keyframes ko-breathe { 0%,100% { transform:scale(1) } 50% { transform:scale(1.035) } }
        @keyframes ko-tw { 0%,100% { opacity:.08; transform:scale(.6) } 50% { opacity:.6; transform:scale(1) } }
        @keyframes ko-bars-in { 0% { transform:translateY(var(--bar-out,-100%)) } 4% { transform:none } 86% { transform:none; opacity:1 } 100% { opacity:0; transform:translateY(var(--bar-out,-100%)) } }
        @keyframes ko-shimenawa { 0% { opacity:0; transform:translateY(-110%) } 100% { opacity:1; transform:none } }
        @keyframes ko-sway { 0%,100% { transform:rotate(-4deg) } 50% { transform:rotate(4deg) } }
        @keyframes ko-curtain { 0% { opacity:1; transform:none } 88% { opacity:1; transform:translateX(106%) } 100% { opacity:0; transform:translateX(106%) } }
        @keyframes ko-ki { 0% { opacity:0 } 6% { opacity:.9 } 12% { opacity:0 } 38% { opacity:0 } 44% { opacity:.9 } 50% { opacity:0 } 68% { opacity:0 } 73% { opacity:.95 } 79% { opacity:0 } 100% { opacity:0 } }
        @keyframes ko-rainline { 0% { opacity:0 } 100% { opacity:.3 } }
        @keyframes ko-bow { 0% { opacity:0; transform:translateY(30px) } 60% { opacity:.88; transform:translateY(0) rotate(14deg) } 100% { opacity:.88; transform:translateY(2px) rotate(16deg) } }
        @keyframes ko-bow-c { 0% { opacity:0; transform:translateY(26px) } 60% { opacity:.9; transform:translateY(0) rotate(0) } 100% { opacity:.9; transform:translateY(5px) rotate(7deg) } }
        @keyframes ko-tag { 0% { opacity:0; transform:translateY(-44px) rotate(-4deg) } 62% { opacity:1; transform:translateY(4px) rotate(1deg) } 100% { opacity:1; transform:none } }
        /* カメラ（外=ドリー/中=パンチ/内=シェイク） */
        @keyframes ko-dolly-r   { 0% { transform:scale(1) }    100% { transform:scale(1.05) } }
        @keyframes ko-dolly-sr  { 0% { transform:scale(1) }    100% { transform:scale(1.06) } }
        @keyframes ko-dolly-ssr { 0% { transform:scale(1) }    100% { transform:scale(1.08) } }
        @keyframes ko-dolly-ur  { 0% { transform:scale(1) }    100% { transform:scale(1.06) } }
        @keyframes ko-dolly-lr  { 0% { transform:scale(1) }    100% { transform:scale(1.10) } }
        @keyframes ko-punch-sr  { 0% { transform:scale(1) } 8% { transform:scale(1.06) } 20% { transform:scale(.985) } 44% { transform:scale(1.045) } 74% { transform:scale(1.045) } 100% { transform:scale(1) } }
        @keyframes ko-punch-ssr { 0% { transform:scale(1) } 7% { transform:scale(1.07) } 18% { transform:scale(.99) } 38% { transform:scale(1.05) } 72% { transform:scale(1.05) } 100% { transform:scale(1) } }
        @keyframes ko-punch-ur  { 0% { transform:scale(1) } 5% { transform:scale(1.12) } 14% { transform:scale(.985) } 36% { transform:scale(1.03) } 58% { transform:scale(1.075) } 84% { transform:scale(1.075) } 100% { transform:scale(1) } }
        @keyframes ko-punch-lr  { 0% { transform:scale(1) } 6% { transform:scale(1.1) } 16% { transform:scale(.98) } 34% { transform:scale(1.06) } 78% { transform:scale(1.06) } 100% { transform:scale(1) } }
        @keyframes ko-jerk { 0% { transform:none } 20% { transform:translateX(-4px) } 45% { transform:translateX(4px) } 70% { transform:translateX(-2px) } 100% { transform:none } }
        @keyframes ko-shake { 0%,100% { transform:translate(0,0) } 18% { transform:translate(-6px,4px) } 38% { transform:translate(6px,-4px) } 58% { transform:translate(-4px,-3px) } 80% { transform:translate(4px,3px) } }
        @keyframes ko-wobble { 0%,100% { transform:translate(0,0) } 25% { transform:translate(1.4px,-1px) } 50% { transform:translate(-1.2px,1.2px) } 75% { transform:translate(1px,.8px) } }

        .ko-anim, .ko-fx { animation-fill-mode: both !important; }
        /* ko-fx＝一過性のエフェクト。完成形では消えているのが正。
           終端状態クラス（ko-half/ko-dim30/ko-bowed*）は自然完走時の見た目に skip/reduced を揃えるため、
           .ko-anim の opacity:1 より後置して勝たせる（同特異度・ソース順で勝つ）。 */
        @media (prefers-reduced-motion: reduce) {
          .fxa { animation: none !important; } /* カメラ層・回転光条・瞬き・紙垂・呼吸など素の .fxa も全停止 */
          .ko-anim { animation: none !important; opacity: 1 !important; transform: none !important; filter: none !important; }
          .ko-fx { animation: none !important; opacity: 0 !important; }
          .ko-half { opacity: .5 !important; }
          .ko-dim30 { opacity: .3 !important; }
          .ko-bowed { opacity: .88 !important; transform: translateY(2px) rotate(16deg) !important; }
          .ko-bowed-c { opacity: .9 !important; transform: translateY(5px) rotate(7deg) !important; }
        }
        .ko-skip .ko-anim { animation: none !important; opacity: 1 !important; transform: none !important; filter: none !important; }
        .ko-skip .ko-fx { animation: none !important; opacity: 0 !important; }
        .ko-skip .ko-cam { animation: none !important; transform: none !important; } /* 遅延発火のパンチ/シェイクが完成画面上で暴れないよう即停止 */
        .ko-skip .ko-half { opacity: .5 !important; }
        .ko-skip .ko-dim30 { opacity: .3 !important; }
        .ko-skip .ko-bowed { opacity: .88 !important; transform: translateY(2px) rotate(16deg) !important; }
        .ko-skip .ko-bowed-c { opacity: .9 !important; transform: translateY(5px) rotate(7deg) !important; }
      `}</style>

      {/* 周辺減光 */}
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 140px 50px rgba(0,0,0,${s.vignette})` }} />

      {/* 漆黒に瞬く金粒（全階級の空気） */}
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={`d${i}`} className="fxa pointer-events-none absolute h-1 w-1 rounded-full" style={{ left: `${14 + ((i * 73) % 72)}%`, top: `${16 + ((i * 41) % 68)}%`, background: "#e8d1a0", ...va("ko-tw", i * 0.4, 3, "ease-in-out", "infinite") }} />
      ))}

      {/* 鈴の宣（輪の本数と色で格を正直に宣言する） */}
      {s.rings.map((r, i) => (
        <span key={`r${i}`} className="fxa ko-fx pointer-events-none absolute left-1/2 top-[42%] h-40 w-40 rounded-full" style={{ border: `2px solid ${r.color}`, ...va("ko-ring", r.at, 1.1, "ease-out") }} />
      ))}

      {/* 常夜灯（N/R）: 上部の暖色グロー */}
      {s.lantern && [0, 1].map((k) => (
        <span key={`l${k}`} className="fxa ko-anim ko-half pointer-events-none absolute top-[8%] h-40 w-40 rounded-full" style={{ [k === 0 ? "left" : "right"]: "6%", background: "radial-gradient(circle, rgba(226,178,102,.5), transparent 70%)", ...va("ko-lantern", 0.3 + k * 0.9, 3, "ease-in-out", "infinite") }} />
      ))}

      {/* シネスコ黒帯（UR/LR）＝ここから映画 */}
      {s.bars && (
        <>
          <div className="fxa ko-fx pointer-events-none absolute inset-x-0 top-0 z-[24] h-[8vh] bg-black" style={{ ...va("ko-bars-in", 0, s.dur * 0.92, "ease-out"), ["--bar-out" as string]: "-100%" }} />
          <div className="fxa ko-fx pointer-events-none absolute inset-x-0 bottom-0 z-[24] h-[8vh] bg-black" style={{ ...va("ko-bars-in", 0, s.dur * 0.92, "ease-out"), ["--bar-out" as string]: "100%" }} />
        </>
      )}

      {/* 注連縄の結界（UR）: 縄＋紙垂4本が上端に降りる */}
      {s.shimenawaAt !== undefined && (
        <div className="fxa ko-anim pointer-events-none absolute inset-x-0 top-[8vh] z-[6]" style={va("ko-shimenawa", s.shimenawaAt, 0.7, "cubic-bezier(.2,1,.3,1)")}>
          <svg viewBox="0 0 400 60" className="w-full" preserveAspectRatio="none" style={{ height: 56 }}>
            <path d="M0,14 Q100,30 200,22 Q300,14 400,26" stroke="#6b5636" strokeWidth="7" fill="none" />
            <path d="M0,14 Q100,30 200,22 Q300,14 400,26" stroke="#8a744a" strokeWidth="2.5" fill="none" strokeDasharray="7 6" />
          </svg>
          {[70, 165, 250, 340].map((x, i) => (
            <div key={i} className="fxa absolute" style={{ left: `${(x / 400) * 100}%`, top: 22, transformOrigin: "top center", ...va("ko-sway", i * 0.35, 2.4, "ease-in-out", "infinite") }}>
              <svg width="16" height="42" viewBox="0 0 16 42">
                <path d="M2,0 L14,0 L14,10 L5,13 L14,17 L14,27 L5,30 L14,34 L14,42 L2,42 Z" fill="rgba(243,239,230,.85)" />
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* 柝三打（LR）: 画面左右端の金線が刻んで明滅 */}
      {s.kiAt !== undefined && (
        <>
          <span className="fxa ko-fx pointer-events-none absolute inset-y-0 left-0 z-[31] w-[2px]" style={{ background: "#e6cf86", ...va("ko-ki", s.kiAt, 1.5, "linear") }} />
          <span className="fxa ko-fx pointer-events-none absolute inset-y-0 right-0 z-[31] w-[2px]" style={{ background: "#e6cf86", ...va("ko-ki", s.kiAt + 0.06, 1.5, "linear") }} />
        </>
      )}

      {/* 虹のヘアライン（LR）: 知る者だけが震える紋 */}
      {s.rainbow && (
        <div className="fxa ko-anim ko-dim30 pointer-events-none absolute inset-2 z-[5] rounded-2xl" style={{ border: "1px solid transparent", background: "linear-gradient(#0000,#0000) padding-box, conic-gradient(from 20deg, #d8b85a, #7fae8f, #7f96c9, #a97fc9, #c97f92, #d8b85a) border-box", opacity: 0.3, ...va("ko-rainline", 0.5, 1.2, "ease-out") }} />
      )}

      {/* ============ カメラ（ドリー > パンチ > シェイク > 手持ち > 附け打ちジャーク）。ko-cam=skip/reduced で停止 ============ */}
      <div className="fxa ko-cam relative z-[8]" data-slow style={s.dolly ? va(s.dolly.name, s.dolly.at, s.dolly.dur, "cubic-bezier(.25,.6,.3,1)") : undefined}>
        <div className="fxa ko-cam" style={s.punch ? va(s.punch.name, s.punch.at, s.punch.dur, "cubic-bezier(.3,1.2,.4,1)") : undefined}>
          <div className="fxa ko-cam" style={s.shakeAt !== undefined ? va("ko-shake", s.shakeAt, 0.55, "ease-in-out") : undefined}>
            <div className="fxa ko-cam" style={s.wobble ? va("ko-wobble", 1.2, 2.8, "ease-in-out", "infinite") : undefined}>
              <div className="fxa ko-cam" style={s.jerkAts[0] !== undefined ? va("ko-jerk", s.jerkAts[0], 0.3, "ease-out") : undefined}>
              <div className="relative flex flex-col items-center px-8">
                {/* 書：銘柄名（SR/LRは打ち込み気味） */}
                <p className="mb-4 flex gap-[1px] text-[19px] font-medium tracking-wide" style={{ fontFamily: MINCHO, color: m.ring }}>
                  {chars.map((ch, i) => (
                    <span key={i} className="fxa ko-anim inline-block" style={va(s.charHit ? "ko-char-hit" : "ko-char", s.charAt + i * s.charStep, 0.45)}>{ch}</span>
                  ))}
                </p>

                {/* 御札の額装 */}
                <div className="relative" style={{ width: frameW, height: frameH }}>
                  {/* ゴッドレイ（conicの光条円盤・回転） */}
                  {s.raysAt !== undefined && (
                    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 460, height: 460, opacity: s.raysOp }}>
                      <div className="fxa ko-anim absolute inset-0" style={va("ko-fadein", s.raysAt, 0.8, "ease-out")}>
                        <div className="fxa h-full w-full rounded-full" data-slow style={{ background: "repeating-conic-gradient(rgba(232,209,160,.5) 0deg 7deg, transparent 7deg 26deg)", WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,.9) 20%, transparent 68%)", maskImage: "radial-gradient(circle, rgba(0,0,0,.9) 20%, transparent 68%)", ...va("ko-rot", 0, 22, "linear", "infinite") }} />
                        {s.raysDouble && (
                          <div className="fxa absolute inset-6 rounded-full" data-slow style={{ background: "repeating-conic-gradient(rgba(216,184,90,.4) 0deg 5deg, transparent 5deg 32deg)", WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,.8) 16%, transparent 60%)", maskImage: "radial-gradient(circle, rgba(0,0,0,.8) 16%, transparent 60%)", ...va("ko-rot-rev", 0, 30, "linear", "infinite") }} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* シルエット逆光（SSR）: 御姿の背後に光が立つ */}
                  {s.backlightAt !== undefined && (
                    <span className="fxa ko-fx pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${m.ring}66, transparent 66%)`, ...va("ko-backlight", s.backlightAt, 1.4, "ease-out") }} />
                  )}

                  {/* リムライト（R以上の余韻） */}
                  {s.rimAt !== undefined && (
                    <span className="fxa ko-anim ko-half pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${m.ring}44, transparent 68%)`, ...va("ko-fadein-half", s.rimAt, 1.2, "ease-out") }} />
                  )}

                  {/* 虹輪（LR開眼後・額の背後で回る）: opacity はラッパーが担い、ko-fadein(終端1)がそれを潰さない構造 */}
                  {s.rainbow && (
                    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: frameW + 26, height: frameW + 26, opacity: 0.55 }}>
                      <div className="fxa ko-anim h-full w-full" style={va("ko-fadein", 5.6, 1.0, "ease-out")}>
                        <div className="fxa h-full w-full rounded-full" data-slow style={{ background: "conic-gradient(from 0deg, #d8b85a, #86b897, #86a0d0, #b18ad0, #d08a9c, #d8b85a)", WebkitMaskImage: "radial-gradient(circle, transparent 58%, #000 60%, #000 66%, transparent 68%)", maskImage: "radial-gradient(circle, transparent 58%, #000 60%, #000 66%, transparent 68%)", ...va("ko-rot", 0, 9, "linear", "infinite") }} />
                      </div>
                    </div>
                  )}

                  {/* 額装フレーム */}
                  <div className="fxa ko-anim absolute inset-0 overflow-hidden rounded-2xl" style={{ background: "#0d1f17", boxShadow: `0 0 0 3px ${m.color}, 0 0 36px ${m.ring}88, inset 0 0 0 1px rgba(232,209,160,.5)`, ...va("ko-frame", s.frameAt, 0.55, "cubic-bezier(.2,.9,.3,1.15)") }}>
                    <div className="fxa h-full w-full" data-slow style={va("ko-breathe", s.finishedAt, 3, "ease-in-out", "infinite")}>
                      {artUrl ? (
                        <>
                          <Image src={artUrl} alt="" width={448} height={560} sizes="224px" className="h-full w-full object-cover" priority unoptimized />
                          {/* 墨（グレースケール静的レイヤー）→ 色: opacityクロスフェードのみ（filterはアニメしない） */}
                          {s.grayAt !== undefined && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={artUrl} alt="" className="fxa ko-fx absolute inset-0 h-full w-full object-cover" style={{ filter: "grayscale(1) brightness(.5) contrast(1.15)", ...va("ko-fadeout", s.grayAt, s.grayDur ?? 1, "ease-out") }} />
                          )}
                        </>
                      ) : (
                        <div className="h-full w-full" style={{ background: `linear-gradient(160deg, ${m.color}, #0e2a20)` }} />
                      )}
                      {/* 黒からの開帳（SSR/UR/LR）: 御姿は光が入るまで闇の中 */}
                      {s.coverAt !== undefined && (
                        <div className="fxa ko-fx absolute inset-0 bg-black" style={va("ko-fadeout", s.coverAt, s.coverDur ?? 0.45, "ease-out")} />
                      )}
                      {/* 斬られて割れる（SR）: 黒が上下に割れて色が出る */}
                      {s.splitAt !== undefined && (
                        <>
                          <div className="fxa ko-fx absolute inset-x-0 top-0 h-1/2 bg-black" style={va("ko-split-t", s.splitAt, 0.45, "cubic-bezier(.2,.8,.3,1)")} />
                          <div className="fxa ko-fx absolute inset-x-0 bottom-0 h-1/2 bg-black" style={va("ko-split-b", s.splitAt, 0.45, "cubic-bezier(.2,.8,.3,1)")} />
                        </>
                      )}
                      {/* 色収差（UR落雷の一瞬・額の中だけ） */}
                      {s.aberrAt !== undefined && (
                        <>
                          <div className="fxa ko-fx pointer-events-none absolute inset-0" style={{ background: "rgba(255,40,40,.28)", mixBlendMode: "screen", ...va("ko-aberr-r", s.aberrAt, 0.22, "ease-out") }} />
                          <div className="fxa ko-fx pointer-events-none absolute inset-0" style={{ background: "rgba(40,200,255,.28)", mixBlendMode: "screen", ...va("ko-aberr-c", s.aberrAt, 0.22, "ease-out") }} />
                        </>
                      )}
                    </div>
                  </div>

                  {/* 衝撃波 */}
                  {s.shockAts.map((sh, i) => (
                    <span key={`s${i}`} className="fxa ko-fx pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 rounded-full" style={{ border: `2px solid ${sh.color}`, ...va("ko-shock", sh.at, 1.0, "ease-out") }} />
                  ))}

                  {/* 朱の落款（綴じ） */}
                  <div className="fxa ko-anim absolute -bottom-4 -right-4 flex flex-col items-center justify-center rounded-xl text-white" style={{ width: s.sealSlam ? 72 : 64, height: s.sealSlam ? 72 : 64, background: "#9b2d20", boxShadow: "0 6px 18px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(243,239,230,.8)", fontFamily: MINCHO, ...va("ko-seal", s.sealAt, s.sealSlam ? 0.45 : 0.6, "cubic-bezier(.2,.8,.3,1.3)") }}>
                    <span className="text-[15px] leading-none">酒神</span>
                    <span className="mt-0.5 text-[8px] leading-none opacity-80">迎</span>
                  </div>

                  {/* 金の木札「伝説」（LR） */}
                  {s.tagAt !== undefined && (
                    <div className="fxa ko-anim absolute -left-6 -top-3 flex flex-col items-center rounded-sm px-1.5 py-2" style={{ background: "linear-gradient(165deg,#3a2f18,#241c0e)", boxShadow: "0 4px 14px rgba(0,0,0,.6), inset 0 0 0 1px #d8b85a", fontFamily: MINCHO, ...va("ko-tag", s.tagAt, 0.6, "cubic-bezier(.25,1.2,.4,1)") }}>
                      <span className="text-[12px] font-bold leading-tight text-[#e8d1a0]" style={{ writingMode: "vertical-rl" }}>伝説</span>
                    </div>
                  )}
                </div>

                {/* 言祝ぎ */}
                <div className="fxa ko-anim mt-7 text-center" style={va("ko-rise", s.blessAt, 0.5)}>
                  <span className="rounded-md px-2.5 py-1 text-[13px] font-extrabold text-white" style={{ background: m.color, boxShadow: rank >= 3 ? `0 0 14px ${m.ring}88` : "none" }}>{rarity}・{m.jp}</span>
                  <p className="mt-2.5 text-[14px] tracking-wide" style={{ fontFamily: MINCHO, color: m.ring }}>
                    <T ja={s.blessJa} en={s.blessEn} />
                  </p>
                </div>
                <div className="fxa ko-anim mt-2 text-center" style={va("ko-rise", s.bless2At ?? s.blessAt + 0.25, 0.5)}>
                  <p className="text-[15px] tracking-wide" style={{ fontFamily: MINCHO, color: m.ring }}>
                    <T ja={`${name || "酒神"}、あなたの社に宿りたまえり。`} en={`The god ${name || ""} now dwells in your shrine.`} />
                    {extra > 0 ? <T ja={`（ほか${extra}柱）`} en={` (+${extra} more)`} /> : ""}
                  </p>
                  <p className="mt-2 text-[10px] text-white/35"><T ja="このキャラクターは酒蔵とは一切関係がありません" en="This character has no affiliation with the brewery" /></p>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* パーティクル層（SSR/UR/LRのみ・タップはroot任せ） */}
      {s.canvas && <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[14]" />}

      {/* 金のワイプ（R）: 色が「差す」 */}
      {s.wipeAt !== undefined && (
        <div className="fxa ko-fx pointer-events-none absolute left-1/2 top-1/2 z-[12] h-[160vh] w-[26vw] -translate-x-1/2 -translate-y-1/2" style={{ background: "linear-gradient(90deg, transparent, rgba(232,209,160,.22), transparent)", ...va("ko-wipe", s.wipeAt, 0.7, "cubic-bezier(.4,0,.2,1)") }} />
      )}

      {/* 一閃（SR）: 細い金光帯が走り抜ける */}
      {s.slashAt !== undefined && (
        <div className="fxa ko-fx pointer-events-none absolute left-1/2 top-[40%] z-[16] h-[2px] w-[150vw] -translate-x-1/2" style={{ background: "linear-gradient(90deg, transparent, #f2e2b8, #d8b85a, #f2e2b8, transparent)", boxShadow: "0 0 12px rgba(232,209,160,.8)", ...va("ko-slash", s.slashAt, 0.32, "cubic-bezier(.6,0,.2,1)") }} />
      )}

      {/* 溜め・静寂（浅い暗転） */}
      {s.dipAt !== undefined && (
        <div className="fxa ko-fx pointer-events-none absolute inset-0 z-[18] bg-black" style={va("ko-dip", s.dipAt, s.dipDur ?? 0.7, "ease-in-out")} />
      )}

      {/* 附け打ち（白2連） */}
      {s.tsukeAts.map((t, i) => (
        <div key={`tk${i}`} className="fxa ko-fx pointer-events-none absolute inset-0 z-[19] bg-white" style={va("ko-tsuke", t, 0.32, "linear")} />
      ))}

      {/* レア度フラッシュ（白系のみ・金の面は張らない）。--fmax でピーク不透明度を階級ごとに */}
      {s.flashAts.map((f, i) => (
        <div key={`fl${i}`} className="fxa ko-fx pointer-events-none absolute inset-0 z-[19]" style={{ background: f.color, ...va("ko-flash", f.at, f.dur, "ease-out"), ["--fmax" as string]: f.max }} />
      ))}

      {/* 全消灯→開眼（LR） */}
      {s.deepAt !== undefined && (
        <div className="fxa ko-fx pointer-events-none absolute inset-0 z-[20] bg-black" style={va("ko-deep", s.deepAt, s.deepDur ?? 1.4, "ease-in-out")} />
      )}
      {s.lidAt !== undefined && (
        <>
          <div className="fxa ko-fx pointer-events-none absolute inset-x-0 top-0 z-[21] h-1/2 bg-black" style={va("ko-lid-t", s.lidAt, 1.5, "cubic-bezier(.5,0,.2,1)")} />
          <div className="fxa ko-fx pointer-events-none absolute inset-x-0 bottom-0 z-[21] h-1/2 bg-black" style={va("ko-lid-b", s.lidAt, 1.5, "cubic-bezier(.5,0,.2,1)")} />
        </>
      )}
      {s.eyelineAt !== undefined && (
        <div className="fxa ko-fx pointer-events-none absolute inset-x-6 top-1/2 z-[22] h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #f2e2b8, #fffef8, #f2e2b8, transparent)", boxShadow: "0 0 18px rgba(242,226,184,.9)", ...va("ko-eyeline", s.eyelineAt, 0.5, "ease-out") }} />
      )}

      {/* 定式幕（LR開幕）: 常磐×漆黒×朱の三色縦縞が引かれる */}
      {s.curtain && (
        <div className="fxa ko-fx pointer-events-none absolute inset-0 z-[30]" style={{ background: "repeating-linear-gradient(90deg, #1f4636 0 12vw, #0e0c0a 12vw 24vw, #7a2318 24vw 36vw)", ...va("ko-curtain", 1.6, 1.0, "cubic-bezier(.7,0,.2,1)") }} />
      )}

      {/* すぎだまる（UR=右下で平伏／LR=中央で深い礼）: 宵闇に沈めて気配にする */}
      {s.mascot && (
        <div
          className={`fxa ko-anim ${s.mascot.pos === "center" ? "ko-bowed-c" : "ko-bowed"} pointer-events-none absolute z-[23] ${s.mascot.pos === "center" ? "bottom-[13vh] left-1/2 -ml-7" : "bottom-[12vh] right-[8%]"}`}
          style={va(s.mascot.pos === "center" ? "ko-bow-c" : "ko-bow", s.mascot.at, 0.9, "cubic-bezier(.25,1,.35,1)")}
        >
          <div className="relative overflow-hidden rounded-full" style={{ width: s.mascot.size, height: s.mascot.size }}>
            <Mascot size={s.mascot.size} className="!rounded-full" />
            <span className="absolute inset-0 rounded-full" style={{ background: "rgba(4,8,5,.32)" }} />
          </div>
        </div>
      )}

      {/* LRの言祝ぎ第一声「これは……っ。」は blessAt、正式な言祝ぎは bless2At（上のブロック） */}

      <p className="absolute bottom-7 z-[31] text-[11px] text-white/45">
        {finished ? <T ja="タップで閉じる" en="Tap to close" /> : <T ja="タップでスキップ" en="Tap to skip" />}
      </p>
    </div>
  );
}
