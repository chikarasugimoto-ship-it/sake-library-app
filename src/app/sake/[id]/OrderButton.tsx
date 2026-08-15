"use client";

import { useState } from "react";
import { useCart, currentTable, orderingUiEnabled, type CartSake } from "@/lib/cart";
import { SizePicker } from "@/components/SizePicker";
import { T } from "@/components/T";

// 詳細ページの「注文に追加」。注文UIが有効＆卓QRで来ているときだけ表示。
// 2026-08-16 サイズ対応: タップでサイズ選択シート（グラス/1合/熱燗）を開く。
// カートに入っている数（この銘柄・サイズ横断）はボタンに出し、増減もシート内で行う。
export function OrderButton({ sake, kanOk = false }: { sake: CartSake; kanOk?: boolean }) {
  const { lines } = useCart();
  const [open, setOpen] = useState(false);
  if (!orderingUiEnabled() || !currentTable()) return null;

  const inCart = lines.filter((l) => l.item.id === sake.id).reduce((n, l) => n + l.qty, 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white active:scale-[0.99]"
      >
        {inCart === 0 ? (
          <>
            🍶 <T ja="この日本酒を注文に追加" en="Add this sake to your order" />
          </>
        ) : (
          <>
            🍶 <T ja={`カートに ${inCart}つ ・ サイズを選んで追加`} en={`${inCart} in cart · choose a size`} />
          </>
        )}
      </button>
      <SizePicker sake={sake} kanOk={kanOk} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
