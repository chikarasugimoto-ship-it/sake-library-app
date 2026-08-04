"use client";

import { useEffect, useState } from "react";
import { addToCart, setQty, useCart, currentTable, orderingUiEnabled, type CartItem } from "@/lib/cart";
import { haptic } from "@/lib/haptics";

// クイック注文。注文UIが有効＆卓QRで来ているときだけ出る。
// 0杯のときは「＋」、1杯以上は「− 杯数 ＋」のステッパー。
// className には“配置だけ”を渡す（カード隅の absolute / リスト行の inline）。見た目はここで付ける。
// ＋押下＝ハプティック＋「＋1」がふわっと立つゲーム的な手応え。
export function QuickAdd({ sake, className = "" }: { sake: CartItem; className?: string }) {
  const { lines } = useCart();
  const [mounted, setMounted] = useState(false);
  const [pop, setPop] = useState(0); // 「＋1」演出のトリガ（増えるたびに+1）
  useEffect(() => setMounted(true), []);
  if (!mounted || !orderingUiEnabled() || !currentTable()) return null;

  const qty = lines.find((l) => l.item.id === sake.id)?.qty ?? 0;
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const add = (e: React.MouseEvent) => {
    stop(e);
    haptic(14);
    addToCart(sake);
    setPop((n) => n + 1);
  };
  const dec = (e: React.MouseEvent) => {
    stop(e);
    haptic(8);
    setQty(sake.id, qty - 1);
  };

  const popFx = pop > 0 && (
    <>
      <style>{`@keyframes qa-pop { 0% { opacity:0; transform:translate(-50%,0) scale(.6) } 25% { opacity:1 } 100% { opacity:0; transform:translate(-50%,-34px) scale(1.1) } }
      @media (prefers-reduced-motion: reduce){ .qa-pop{ display:none } }`}</style>
      <span key={pop} className="qa-pop pointer-events-none absolute -top-1 left-1/2 z-30 text-[13px] font-extrabold text-[#caa86a]" style={{ animation: "qa-pop .9s ease-out forwards", textShadow: "0 1px 4px rgba(0,0,0,.4)" }}>＋1🍶</span>
    </>
  );

  if (qty === 0) {
    return (
      <button
        onClick={add}
        aria-label={`${sake.brand}を注文に追加`}
        className={`${className} relative z-20 flex h-9 w-9 items-center justify-center rounded-full bg-moss text-white shadow-md transition-transform active:scale-90`}
        style={{ boxShadow: "0 2px 8px rgba(0,0,0,.25), 0 0 0 2px rgba(202,168,106,.35)" }}
      >
        <span className="text-lg leading-none">＋</span>
        {popFx}
      </button>
    );
  }
  return (
    <div onClick={stop} className={`${className} relative z-20 flex h-9 items-center rounded-full bg-moss px-1 text-white shadow-md`} style={{ boxShadow: "0 2px 8px rgba(0,0,0,.25), 0 0 0 2px rgba(202,168,106,.35)" }}>
      <button onClick={dec} aria-label="1杯減らす" className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none transition-transform active:scale-90">−</button>
      <span className="min-w-[1.1ch] px-0.5 text-center text-sm font-bold tabular-nums">{qty}</span>
      <button onClick={add} aria-label="1杯増やす" className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none transition-transform active:scale-90">＋</button>
      {popFx}
    </div>
  );
}
