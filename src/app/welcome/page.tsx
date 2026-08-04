"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { currentTable } from "@/lib/cart";
import { T } from "@/components/T";
import { useLang } from "@/lib/lang";

const MINCHO = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";

// ===== 操作デモ（任意・「あそびかた」）で使う本物の中身 =====
const CARDS = [
  { id: 60, name: "黒龍 大吟醸", sub: "福井", price: "1,200", hot: true },
  { id: 14, name: "酔鯨 純米吟醸", sub: "高知", price: "800" },
  { id: 18, name: "雪の茅舎", sub: "秋田", price: "900" },
  { id: 31, name: "上喜元 純米", sub: "山形", price: "850" },
];
const REVEAL_GOD = 60;
const GRID_GODS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 38, 48];
// オープニングの「図鑑が酒神で満ちていく」ビート用（実際の図鑑のように酒神が次々増える様子）
const ZUKAN_CELLS = [14, 48, 22, 38, 26, 16, 19, 24, 25, 15, 17, 20]; // 12マス（手前から順に集まる）
const ZUKAN_REVEAL = 9; // このうち9体を“集めた”状態に（残り3マスは「まだ見ぬ神」＝飢餓感）
const SECRET = [
  { id: 55, ja: "十四代" },
  { id: 56, ja: "新政" },
  { id: 71, ja: "勝駒" },
];

function MiniCard({ id, name, sub, price, hot }: { id: number; name: string; sub: string; price: string; hot?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white" style={{ boxShadow: hot ? "0 0 0 2px #caa86a" : "0 1px 3px rgba(0,0,0,.18)" }}>
      <div className="relative aspect-[4/5] bg-[#ece6da]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/photo/${id}`} alt="" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
        <div className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-[#16352a]" style={{ background: "#caa86a" }}>＋</div>
      </div>
      <div className="px-1.5 py-1 text-left">
        <div className="truncate text-[8px] font-bold text-[#1a3a2b]">{name}</div>
        <div className="text-[7px] text-[#7d7a70]">{sub}　¥{price}</div>
      </div>
    </div>
  );
}

// ===== 操作デモ本体（任意再生・5場面） =====
function Demo({ table, onDone }: { table: string; onDone: () => void }) {
  const [beat, setBeat] = useState(0);
  const [godOk, setGodOk] = useState(true);
  const [kount, setKount] = useState(28);

  useEffect(() => {
    const timers = [
      setTimeout(() => setBeat(1), 2300),
      setTimeout(() => setBeat(2), 5100),
      setTimeout(() => setBeat(3), 8100),
      setTimeout(() => setBeat(4), 10100),
      setTimeout(() => onDone(), 13600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  useEffect(() => {
    if (beat !== 2) return;
    setKount(24);
    let n = 24;
    let iv: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      iv = setInterval(() => { n += 1; setKount(n); if (n >= 28 && iv) clearInterval(iv); }, 130);
    }, 650);
    return () => { clearTimeout(start); if (iv) clearInterval(iv); };
  }, [beat]);

  const caps = [
    { ja: "① 飲みたい酒を、注文", en: "① Order a sake you like" },
    { ja: "② 飲んだ酒が、酒神になる", en: "② Your sake becomes a god" },
    { ja: "③ 図鑑に登録！ ぐんぐん増える", en: "③ Added! Your count climbs" },
    { ja: "④ ランキングで、みんなと競う", en: "④ Compete on the ranking" },
    { ja: "⑤ 50種ごとに、幻の隠し酒が解禁！", en: "⑤ Every 50 kinds unlocks a secret sake!" },
  ];

  return (
    <main onClick={onDone} className="relative flex min-h-dvh cursor-pointer flex-col items-center justify-center overflow-hidden px-6 text-center" style={{ background: "radial-gradient(120% 90% at 50% 30%, #1f4636 0%, #163a2c 52%, #0e2a20 100%)" }}>
      <style>{`
        @keyframes dm-fade { from { opacity:0 } to { opacity:1 } }
        @keyframes dm-flash { 0% { opacity:0 } 12% { opacity:1 } 100% { opacity:0 } }
        @keyframes dm-rarity { 0% { opacity:0 } 35% { opacity:.55 } 100% { opacity:0 } }
        @keyframes dm-pop { 0% { opacity:0; transform: scale(.3) } 70% { transform: scale(1.15) } 100% { opacity:1; transform: scale(1) } }
        @keyframes dm-fly { 0% { opacity:0; transform: translateY(8px) scale(.6) } 25% { opacity:1 } 100% { opacity:0; transform: translateY(-54px) scale(1.15) } }
        @keyframes dm-bar { 0% { transform: translateY(130%) } 100% { transform: translateY(0) } }
        @keyframes dm-godburst { 0% { opacity:0; transform: scale(.18) rotate(-12deg) } 55% { opacity:1; transform: scale(1.22) rotate(4deg) } 76% { transform: scale(.94) rotate(-2deg) } 100% { opacity:1; transform: scale(1) rotate(0) } }
        @keyframes dm-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.055) } }
        @keyframes dm-shock { 0% { opacity:.95; transform: translate(-50%,-50%) scale(.25) } 100% { opacity:0; transform: translate(-50%,-50%) scale(2.6) } }
        @keyframes dm-shake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-6px,4px) } 30% { transform: translate(6px,-4px) } 45% { transform: translate(-5px,-3px) } 60% { transform: translate(5px,3px) } 80% { transform: translate(-3px,2px) } }
        @keyframes dm-zoom { from { transform: scale(1.18) } to { transform: scale(1) } }
        @keyframes dm-slam { 0% { opacity:0; transform: scale(2.6) } 55% { opacity:1; transform: scale(.86) } 75% { transform: scale(1.08) } 100% { transform: scale(1) } }
        @keyframes dm-rise { from { opacity:0; transform: translateY(12px) } to { opacity:1; transform: none } }
        @keyframes dm-punch { 0% { opacity:0; transform: scale(1.9) } 60% { opacity:1; transform: scale(.92) } 100% { transform: scale(1) } }
        @keyframes dm-float { 0%,100% { transform: translateY(0) rotate(-1deg) } 50% { transform: translateY(-8px) rotate(1deg) } }
        @keyframes dm-spark { 0% { opacity:0; transform: translate(-50%,-50%) scale(.4) } 25% { opacity:1 } 100% { opacity:0 } }
        @keyframes dm-prog { from { width:0 } to { width:100% } }
      `}</style>
      <div className="mb-3">
        <h1 className="text-[26px] font-medium leading-none text-[#f1e6cf]" style={{ fontFamily: MINCHO }}>あそびかた</h1>
        <p className="mt-1 text-[10px] tracking-[0.3em] text-[#caa86a]" style={{ fontFamily: MINCHO }}>酒コレ ・ 酒神コレクション</p>
      </div>
      <div style={{ animation: "dm-float 5s ease-in-out infinite" }}>
        <div className="relative overflow-hidden" style={{ width: 252, height: 472, borderRadius: 38, background: "#0c1f17", border: "2px solid #caa86a", boxShadow: "0 24px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(202,168,106,.25)" }}>
          <div className="absolute left-1/2 top-2 z-30 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/20" />
          <div key={beat} className="absolute inset-0" style={{ animation: "dm-fade .4s ease-out" }}>
            {beat === 0 && (
              <div className="absolute inset-0 bg-[#f4f2ec] px-2.5 pb-2 pt-7">
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <span className="text-[10px] font-bold text-[#1f6f4f]" style={{ fontFamily: MINCHO }}>本日の日本酒 <span className="text-[#caa86a]">12</span></span>
                  <span className="text-[8px] text-[#9a968c]">{table || "—"}卓</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">{CARDS.map((c) => <MiniCard key={c.id} {...c} />)}</div>
                <span className="absolute left-[92px] top-[150px] z-20 text-[14px] font-extrabold text-[#caa86a]" style={{ animation: "dm-fly 1.7s ease-out .9s both" }}>＋1🍶</span>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3.5 py-2.5 text-white" style={{ background: "#2e6b4d", animation: "dm-bar .6s ease-out 1.4s both" }}>
                  <span className="text-[9.5px] font-bold">1杯 をカートに ・ {table || "—"}卓</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold">¥1,200 <span className="rounded-full bg-white/20 px-2 py-0.5 text-[8px]">確認 ›</span></span>
                </div>
              </div>
            )}
            {beat === 1 && (
              <div className="absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 44%, #4a3818 0%, #0a1f17 70%)", animation: "dm-zoom 3.2s cubic-bezier(.2,.7,.2,1) both" }}>
                {[0, 1].map((k) => (<span key={k} className="absolute left-1/2 top-[44%] h-28 w-28 rounded-full" style={{ border: "3px solid #e8d1a0", animation: `dm-shock 1s ease-out ${0.5 + k * 0.28}s both` }} />))}
                <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ animation: "dm-shake .6s ease-in-out .5s" }}>
                  <div style={{ animation: "dm-godburst 1s cubic-bezier(.2,.9,.3,1.4) .45s both" }}>
                    <div style={{ animation: "dm-breathe 2.6s ease-in-out 1.5s infinite" }}>
                      {godOk ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/god-art/${REVEAL_GOD}`} alt="" className="h-44 w-44 rounded-full object-cover" style={{ boxShadow: "0 0 0 4px #e8d1a0, 0 0 60px rgba(202,168,106,.7)" }} onError={() => setGodOk(false)} />
                      ) : (<div className="flex h-44 w-44 items-center justify-center rounded-full text-[92px]" style={{ boxShadow: "0 0 0 4px #e8d1a0, 0 0 60px rgba(202,168,106,.7)", background: "#143a2c" }}>🐉</div>)}
                    </div>
                  </div>
                  <p className="mt-4 text-[24px] font-extrabold tracking-wide text-white" style={{ animation: "dm-punch .5s cubic-bezier(.2,.8,.3,1.2) 1.15s both", textShadow: "0 2px 14px rgba(0,0,0,.5)" }}>酒神 GET!</p>
                  <span className="mt-2 rounded-md px-3 py-1 text-[12px] font-bold text-white" style={{ background: "#bd9740", animation: "dm-rise .5s ease 1.45s both" }}>SSR ・ コクリュウガ</span>
                </div>
                <div className="pointer-events-none absolute inset-0 bg-white" style={{ animation: "dm-flash .55s ease-out .4s both" }} />
                <div className="pointer-events-none absolute inset-0" style={{ background: "#e8d1a0", animation: "dm-rarity .8s ease-out .55s both" }} />
              </div>
            )}
            {beat === 2 && (
              <div className="absolute inset-0 bg-[#0f2a20] px-3 pb-3 pt-7">
                <div className="pointer-events-none absolute inset-0 bg-[#caa86a]" style={{ animation: "dm-rarity .6s ease-out both" }} />
                <div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-bold text-[#caa86a]" style={{ fontFamily: MINCHO }}>あなたの酒コレ</span><span className="rounded-full bg-[#caa86a] px-2 py-0.5 text-[8px] font-bold text-[#16352a]">利き酒師</span></div>
                <div className="text-center"><span className="inline-block rounded-full bg-[#caa86a] px-3 py-1 text-[11px] font-extrabold text-[#16352a]" style={{ animation: "dm-punch .5s cubic-bezier(.2,.8,.3,1.3) .15s both" }}>📖 図鑑に登録！</span></div>
                <div className="mt-1.5 flex items-baseline justify-center gap-1"><span className="text-[11px] text-[#e8d1a0]">現在</span><span key={kount} className="text-[42px] font-extrabold leading-none text-white" style={{ animation: "dm-punch .3s cubic-bezier(.2,.8,.3,1.3) both", textShadow: "0 0 20px #caa86a" }}>{kount}</span><span className="text-[15px] font-bold text-[#e8d1a0]">種！</span></div>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 20 }).map((_, i) => {
                    const isNew = i === 0; const gid = isNew ? REVEAL_GOD : GRID_GODS[i - 1];
                    return (
                      <div key={i} className="relative aspect-square overflow-hidden rounded-md" style={{ background: gid ? "#1f4636" : "rgba(255,255,255,.05)", boxShadow: isNew ? "0 0 0 2px #ffd76a, 0 0 16px #caa86a" : "none", zIndex: isNew ? 10 : 1, animation: gid ? (isNew ? "dm-slam .6s cubic-bezier(.2,.9,.3,1.4) .2s both" : `dm-pop .4s ease ${0.55 + i * 0.05}s both`) : "none" }}>
                        {gid && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/god-art/${gid}`} alt="" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                        )}
                        {isNew && <span className="absolute right-0 top-0 rounded-bl bg-[#ff6a6a] px-1 text-[6px] font-bold leading-tight text-white" style={{ animation: "dm-pop .4s ease .55s both" }}>NEW</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {beat === 3 && (
              <div className="absolute inset-0 flex flex-col bg-[#0f2a20] px-3 pb-4 pt-7">
                <span className="mb-2 text-[10px] font-bold text-[#caa86a]" style={{ fontFamily: MINCHO }}>🏆 図鑑ランキング</span>
                {[{ r: "1", n: "あなた", k: "28", g: 60, me: true }, { r: "2", n: "T.S さん", k: "26", g: 48, me: false }, { r: "3", n: "M.K さん", k: "21", g: 22, me: false }, { r: "4", n: "Y.N さん", k: "18", g: 38, me: false }].map((row, i) => (
                  <div key={row.r} className="mb-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]" style={{ background: row.me ? "#caa86a" : "rgba(255,255,255,.06)", color: row.me ? "#16352a" : "#f1e6cf", animation: `dm-rise .5s ease ${i * 0.16}s both` }}>
                    <span className="w-3 text-center font-extrabold">{row.r}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/god-art/${row.g}`} alt="" className="h-6 w-6 rounded-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                    <span className="flex-1 text-left font-bold">{row.n}</span><span className="font-bold">{row.k}種</span>
                  </div>
                ))}
                <p className="mt-auto text-center text-[10px] text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "dm-rise .5s ease .7s both" }}>集めた数で、目利きNo.1へ。</p>
              </div>
            )}
            {beat === 4 && (
              <div className="absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 46%, #2b2733 0%, #0d0d12 72%)", animation: "dm-zoom 3.4s cubic-bezier(.2,.7,.2,1) both" }}>
                {Array.from({ length: 14 }).map((_, i) => (<span key={i} className="absolute h-1.5 w-1.5 rounded-full" style={{ left: `${50 + Math.cos((i / 14) * 6.283) * 36}%`, top: `${46 + Math.sin((i / 14) * 6.283) * 32}%`, background: "#ffd76a", animation: `dm-spark ${1.2 + (i % 3) * 0.2}s ease-out ${1.3 + (i % 5) * 0.07}s both` }} />))}
                <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center" style={{ animation: "dm-shake .6s ease-in-out 1.25s" }}>
                  <p className="text-[13px] text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "dm-rise .5s ease .15s both" }}>図鑑を<span className="px-1 text-[19px] font-extrabold text-white">50種</span>集めるごとに…</p>
                  <p className="mt-1 text-[44px] font-extrabold leading-none text-[#ffd76a]" style={{ animation: "dm-punch .5s cubic-bezier(.2,.8,.3,1.3) .6s both", textShadow: "0 3px 16px rgba(0,0,0,.55)" }}>！？！？</p>
                  <div className="mt-3 flex items-start justify-center gap-2">
                    {SECRET.map((s, i) => (
                      <div key={s.id} className="flex flex-col items-center" style={{ animation: `dm-punch .5s cubic-bezier(.2,.8,.3,1.3) ${1.4 + i * 0.28}s both` }}>
                        <div className="h-[88px] w-[58px] overflow-hidden rounded-lg" style={{ boxShadow: "0 0 0 2px #e8d1a0, 0 6px 18px rgba(0,0,0,.5)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/photo/${s.id}`} alt={s.ja} className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                        </div>
                        <p className="mt-1 text-[12px] font-bold text-white" style={{ fontFamily: MINCHO, textShadow: "0 0 12px #caa86a" }}>{s.ja}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] font-bold text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "dm-rise .5s ease 2.3s both" }}>幻の隠し酒、解禁。</p>
                </div>
                <div className="pointer-events-none absolute inset-0 bg-white" style={{ animation: "dm-flash .7s ease-out 1.3s both" }} />
              </div>
            )}
          </div>
        </div>
      </div>
      <p key={`cap${beat}`} className="mt-4 h-6 text-[15px] font-bold text-[#f5efe3]" style={{ fontFamily: MINCHO, animation: "dm-rise .5s ease both" }}><T ja={caps[beat].ja} en={caps[beat].en} /></p>
      <div className="absolute bottom-7 left-0 right-0 flex flex-col items-center gap-2">
        <div className="h-[3px] w-36 overflow-hidden rounded-full bg-white/12"><div className="h-full rounded-full bg-[#e8d1a0]" style={{ animation: "dm-prog 13.6s linear forwards" }} /></div>
        <p className="text-[10px] text-white/45"><T ja="タップでスキップ" en="Tap to skip" /></p>
      </div>
    </main>
  );
}

// 起動で すぎだまる の周りに“ポチポチ”浮かぶ酒神（実アート・立体・バランス配置）
const ORBIT = [
  { id: 14, x: -118, y: -38, s: 52, d: 0.0 },
  { id: 48, x: 120, y: -54, s: 46, d: 0.12 },
  { id: 22, x: -136, y: 56, s: 44, d: 0.24 },
  { id: 38, x: 132, y: 48, s: 50, d: 0.36 },
  { id: 26, x: -56, y: -110, s: 40, d: 0.48 },
  { id: 16, x: 72, y: -114, s: 40, d: 0.6 },
  { id: 19, x: 4, y: 118, s: 46, d: 0.72 },
];

// ===== 起動の顔：すぎだまる(立体)＋酒神が集う → 50種で隠し酒(1杯サービス) =====
export default function Welcome() {
  const router = useRouter();
  const lang = useLang();
  const [table, setTable] = useState("");
  const [mode, setMode] = useState<"gate" | "demo">("gate");
  const [gp, setGp] = useState(0); // 0=すぎだまる＋酒神が集う / 1=図鑑が酒神で満ちていく / 2=50種ごとに隠し酒
  const [filled, setFilled] = useState(0); // gp=1で図鑑に増えていく酒神の数
  const goRef = useRef<() => void>(() => {});
  const done = useRef(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") || currentTable();
    setTable(t);
    goRef.current = () => {
      if (done.current) return;
      done.current = true;
      router.replace(t ? `/?t=${encodeURIComponent(t)}` : "/");
    };
  }, [router]);

  useEffect(() => {
    if (mode !== "gate") return;
    const t1 = setTimeout(() => setGp(1), 3000); // 図鑑が満ちていくビートへ
    const t2 = setTimeout(() => setGp(2), 6200); // 50種ごとに隠し酒
    const t3 = setTimeout(() => goRef.current(), 9400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [mode]);

  // gp=1：図鑑に酒神が次々増えていく（手前から順に灯る）
  useEffect(() => {
    if (gp !== 1) return;
    setFilled(2);
    let n = 2;
    const iv = setInterval(() => { n += 1; setFilled(n); if (n >= ZUKAN_REVEAL) clearInterval(iv); }, 240);
    return () => clearInterval(iv);
  }, [gp]);

  if (mode === "demo") return <Demo table={table} onDone={() => goRef.current()} />;

  return (
    <main
      onClick={() => goRef.current()}
      className="relative flex min-h-dvh cursor-pointer flex-col items-center justify-center overflow-hidden px-8 text-center"
      style={{ background: "radial-gradient(120% 95% at 50% 42%, #173a2c 0%, #0c211a 55%, #050b08 100%)" }}
    >
      <style>{`
        @keyframes gt-ring { 0% { opacity:0; transform:translate(-50%,-50%) scale(.2) } 30% { opacity:.7 } 100% { opacity:0; transform:translate(-50%,-50%) scale(2.3) } }
        @keyframes gt-up { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:none } }
        @keyframes gt-float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-9px) } }
        @keyframes gt-bob { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-7px) } }
        @keyframes gt-pool { 0%,100% { transform:translateX(-50%) scaleX(1); opacity:.5 } 50% { transform:translateX(-50%) scaleX(.78); opacity:.28 } }
        @keyframes gt-pop { 0% { opacity:0; transform:scale(.2) } 65% { opacity:1; transform:scale(1.18) } 100% { opacity:1; transform:scale(1) } }
        @keyframes gt-tw { 0%,100% { opacity:.1; transform:scale(.6) } 50% { opacity:.65; transform:scale(1) } }
        @keyframes gt-bar { from { width:0 } to { width:100% } }
        @keyframes gt-shine { 0% { background-position:220% 0 } 100% { background-position:-220% 0 } }
        @keyframes gt-fade { from { opacity:0 } to { opacity:1 } }
        @keyframes gt-punch { 0% { opacity:0; transform:scale(1.8) } 60% { opacity:1; transform:scale(.94) } 100% { transform:scale(1) } }
        .gt-anim { opacity:0; animation-fill-mode: forwards; }
        @media (prefers-reduced-motion: reduce) { .gt-anim,[data-gtm] { opacity:1 !important; animation:none !important; filter:none !important; transform:none !important } }
      `}</style>

      {/* 画像の先読み */}
      <div aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/mascot" alt="" />
        {ORBIT.map((o) => (/* eslint-disable-next-line @next/next/no-img-element */ <img key={o.id} src={`/api/god-art/${o.id}`} alt="" />))}
        {ZUKAN_CELLS.slice(0, ZUKAN_REVEAL).map((g) => (/* eslint-disable-next-line @next/next/no-img-element */ <img key={`z${g}`} src={`/api/god-art/${g}`} alt="" />))}
        {SECRET.map((s) => (/* eslint-disable-next-line @next/next/no-img-element */ <img key={s.id} src={`/api/photo/${s.id}`} alt="" />))}
      </div>

      {/* 金粒 */}
      {[{ l: "14%", t: "24%", d: 0.5 }, { l: "85%", t: "28%", d: 1.0 }, { l: "22%", t: "72%", d: 0.8 }, { l: "82%", t: "68%", d: 1.4 }, { l: "50%", t: "12%", d: 1.7 }].map((p, i) => (
        <span key={i} className="pointer-events-none absolute h-1 w-1 rounded-full" style={{ left: p.l, top: p.t, background: "#e8d1a0", animation: `gt-tw 3s ease-in-out ${p.d}s infinite` }} />
      ))}
      {/* 祈り：金の輪 */}
      <span className="gt-anim pointer-events-none absolute left-1/2 top-[44%] h-44 w-44 rounded-full" style={{ border: "1.5px solid #caa86a", animation: "gt-ring 1.8s ease-out .2s" }} />

      {/* ブランド */}
      <p className="gt-anim text-[12px] tracking-[0.36em] text-[#caa86a]" style={{ fontFamily: MINCHO, animation: "gt-up 1s ease .3s forwards" }}>酒神奇譚 ・ 酒コレ</p>

      {/* 中央ステージ（gp0=すぎだまる＋酒神 / gp1=50種で隠し酒） */}
      <div key={gp} className="relative my-5 flex items-center justify-center" style={{ width: 300, height: 292, animation: "gt-fade .5s ease-out" }}>
        {gp === 0 ? (
          <>
            {/* ポチポチ浮かぶ酒神（実アート・立体） */}
            {ORBIT.map((o, i) => (
              <div key={o.id} data-gtm className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px))`, animation: `gt-pop .6s cubic-bezier(.2,.9,.3,1.5) ${0.9 + i * 0.13}s both` }}>
                <div style={{ animation: `gt-bob ${3.6 + (i % 3) * 0.6}s ease-in-out ${i * 0.3}s infinite` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/god-art/${o.id}`} alt="" className="rounded-full object-cover" style={{ width: o.s, height: o.s, boxShadow: "0 0 0 2px rgba(202,168,106,.85), 0 8px 16px rgba(0,0,0,.55), 0 0 16px rgba(202,168,106,.45)" }} onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                </div>
              </div>
            ))}
            {/* すぎだまる（立体：後光＋影＋ドロップシャドウ＋浮遊） */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(circle, rgba(202,168,106,.34), transparent 64%)" }} />
              <span className="pointer-events-none absolute left-1/2 top-[120px] h-4 w-28 rounded-[50%]" style={{ background: "radial-gradient(ellipse, rgba(202,168,106,.30), transparent 70%)", animation: "gt-pool 4s ease-in-out infinite" }} />
              <div style={{ animation: "gt-float 4s ease-in-out infinite" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/mascot" alt="すぎだまる" className="relative block h-32 w-32 rounded-full object-cover" style={{ filter: "drop-shadow(0 16px 22px rgba(0,0,0,.6))", boxShadow: "0 0 0 3px rgba(243,239,230,.92), 0 0 30px rgba(202,168,106,.5)" }} onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
              </div>
            </div>
          </>
        ) : gp === 1 ? (
          /* 図鑑が酒神で満ちていく＝実際の図鑑のように酒神が次々増える（コレクションの説明） */
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="mb-2 flex items-center gap-2">
              <span data-gtm className="text-[12px] font-bold tracking-wide text-[#caa86a]" style={{ fontFamily: MINCHO }}>あなたの酒コレ</span>
              <span data-gtm key={filled} className="rounded-full bg-[#caa86a] px-2 py-0.5 text-[10px] font-extrabold text-[#16352a]">{filled}種</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" style={{ width: 266 }}>
              {ZUKAN_CELLS.map((gid, i) => {
                const got = i < filled && i < ZUKAN_REVEAL; // 集めた＝酒神を表示／未取得＝墨に沈んだ「？」
                return (
                  <div key={gid} data-gtm className="relative aspect-square overflow-hidden rounded-lg" style={{ background: got ? "#1f4636" : "#13201a", boxShadow: got ? "0 0 0 1.5px rgba(202,168,106,.7), 0 4px 10px rgba(0,0,0,.4)" : "inset 0 0 0 1px rgba(202,168,106,.12)", animation: got ? "gt-pop .5s cubic-bezier(.2,.9,.3,1.5) both" : "none" }}>
                    {got ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/god-art/${gid}`} alt="" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[15px] text-[#39513f]">？</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p data-gtm className="mt-3 text-[14px] font-bold leading-snug text-[#f5efe3]" style={{ fontFamily: MINCHO }}>飲んだ酒が酒神になって、<br />図鑑に増えていく。</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p data-gtm className="text-[14px] text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "gt-up .5s ease .1s both" }}>図鑑を<span className="px-1 text-[20px] font-extrabold text-white">50種</span>集めるごとに</p>
            <div className="mt-3 flex items-start justify-center gap-2.5">
              {SECRET.map((s, i) => (
                <div key={s.id} data-gtm className="flex flex-col items-center" style={{ animation: `gt-punch .55s cubic-bezier(.2,.8,.3,1.3) ${0.35 + i * 0.24}s both` }}>
                  <div className="overflow-hidden rounded-lg" style={{ width: 62, height: 88, boxShadow: "0 0 0 2px #e8d1a0, 0 10px 22px rgba(0,0,0,.6)", transform: `rotate(${(i - 1) * 4}deg)` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/photo/${s.id}`} alt={s.ja} className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                  </div>
                  <p className="mt-1 text-[12px] font-bold text-white" style={{ fontFamily: MINCHO, textShadow: "0 0 12px #caa86a" }}>{s.ja}</p>
                </div>
              ))}
            </div>
            <p data-gtm className="mt-4 text-[26px] font-extrabold leading-none text-[#ffd76a]" style={{ animation: "gt-punch .55s cubic-bezier(.2,.8,.3,1.3) 1.15s both", textShadow: "0 3px 14px rgba(0,0,0,.55)" }}>1杯、サービス。</p>
            <p data-gtm className="mt-2 text-[11px] text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "gt-up .5s ease 1.45s both" }}>幻の隠し酒、解禁。</p>
          </div>
        )}
      </div>

      {/* タグライン（gp0のみ） */}
      {gp === 0 && (
        <>
          <h1 className="gt-anim text-[20px] font-medium tracking-[0.06em] text-[#f5efe3]" style={{ fontFamily: MINCHO, animation: "gt-up 1s ease 1.7s forwards" }}>
            <T ja="飲んだ日本酒が、図鑑になる。" en="Every sake you drink awakens a god." />
          </h1>
          <p className="gt-anim mt-2 text-[12px] text-[#e8d1a0]" style={{ fontFamily: MINCHO, animation: "gt-up 1s ease 2.0s forwards" }}>
            <T ja="── 飲むほどに、神が集う。" en="── The more you drink, the more gods gather." />
          </p>
        </>
      )}

      {table && (
        <p className="gt-anim mt-4 rounded-full border border-[#caa86a]/40 px-4 py-1.5 text-[12px] font-bold tracking-wider text-[#e8d1a0]" style={{ animation: "gt-up 1s ease 2.3s forwards" }}>
          {lang === "en" ? `Table ${table} · Welcome` : `${table} 卓 ・ ようこそ`}
        </p>
      )}

      {/* 進む導線 ＋ あそびかた */}
      <div className="gt-anim absolute bottom-9 left-0 right-0 flex flex-col items-center gap-3" style={{ animation: "gt-up 1s ease 2.5s forwards" }}>
        <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/12"><div className="h-full rounded-full bg-[#e8d1a0]" style={{ animation: "gt-bar 9.4s linear forwards" }} /></div>
        <p className="text-[13px] font-bold tracking-[0.3em] text-transparent" style={{ fontFamily: MINCHO, backgroundImage: "linear-gradient(100deg,#caa86a 35%,#fff6df 50%,#caa86a 65%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", animation: "gt-shine 3s linear infinite" }}>
          <T ja="門をくぐる ▸" en="Enter the gate ▸" />
        </p>
        <button onClick={(e) => { e.stopPropagation(); setMode("demo"); }} className="rounded-full border border-white/20 px-4 py-1.5 text-[11px] text-white/70 active:scale-95">
          ▷ <T ja="あそびかた" en="How to play" />
        </button>
      </div>
    </main>
  );
}
