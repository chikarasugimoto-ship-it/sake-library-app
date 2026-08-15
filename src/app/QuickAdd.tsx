"use client";

import { useEffect, useState } from "react";
import { useCart, currentTable, orderingUiEnabled, type CartSake } from "@/lib/cart";
import { SizePicker } from "@/components/SizePicker";
import { haptic } from "@/lib/haptics";

// クイック注文。注文UIが有効＆卓QRで来ているときだけ出る。
// 2026-08-16 サイズ対応: タップで毎回サイズ選択シート（グラス/1合/熱燗）を開く＝誤注文防止。
// ボタンには「その銘柄の合計注文数（サイズ横断・提供数）」をバッジ表示する。
// className には“配置だけ”を渡す（カード隅の absolute / リスト行の inline）。見た目はここで付ける。
export function QuickAdd({ sake, kanOk = false, className = "" }: { sake: CartSake; kanOk?: boolean; className?: string }) {
  const { lines } = useCart();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !orderingUiEnabled() || !currentTable()) return null;

  // この銘柄の合計（サイズ横断・提供数）。1合も「1つ」と数える＝手元に届く数
  const qty = lines.filter((l) => l.item.id === sake.id).reduce((n, l) => n + l.qty, 0);
  const openPicker = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic(10);
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={openPicker}
        aria-label={`${sake.brand}のサイズを選んで注文に追加`}
        className={`${className} relative z-20 flex h-9 items-center justify-center rounded-full bg-moss text-white shadow-md transition-transform active:scale-90 ${qty > 0 ? "px-2.5" : "w-9"}`}
        style={{ boxShadow: "0 2px 8px rgba(0,0,0,.25), 0 0 0 2px rgba(202,168,106,.35)" }}
      >
        {qty > 0 ? (
          <span className="text-sm font-bold tabular-nums">🍶{qty}</span>
        ) : (
          <span className="text-lg leading-none">＋</span>
        )}
      </button>
      <SizePicker sake={sake} kanOk={kanOk} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
