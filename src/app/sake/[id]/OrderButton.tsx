"use client";

import { addToCart, setQty, useCart, currentTable, orderingUiEnabled, type CartItem } from "@/lib/cart";
import { T } from "@/components/T";

// 詳細ページの「注文に追加」。注文UIが有効＆卓QRで来ているときだけ表示。
// カートに入っていれば「− 杯数 ＋」で増減できる。
export function OrderButton({ sake }: { sake: CartItem }) {
  const { lines } = useCart();
  if (!orderingUiEnabled() || !currentTable()) return null;

  const inCart = lines.find((l) => l.item.id === sake.id)?.qty ?? 0;

  if (inCart === 0) {
    return (
      <button
        onClick={() => addToCart(sake)}
        className="mt-3 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white active:scale-[0.99]"
      >
        🍶 <T ja="この日本酒を注文に追加" en="Add this sake to your order" />
      </button>
    );
  }
  return (
    <div className="mt-3 flex w-full items-center justify-between rounded-full bg-moss-deep px-3 py-2 text-white">
      <button
        onClick={() => setQty(sake.id, inCart - 1)}
        aria-label="1杯減らす"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none active:scale-90"
      >
        −
      </button>
      <span className="text-[15px] font-bold tracking-wider">
        <T ja={`カートに ${inCart}杯`} en={`${inCart} in cart`} />
      </span>
      <button
        onClick={() => addToCart(sake)}
        aria-label="1杯増やす"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none active:scale-90"
      >
        ＋
      </button>
    </div>
  );
}
