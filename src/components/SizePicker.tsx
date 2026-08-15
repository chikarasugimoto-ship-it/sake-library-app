"use client";

import { useCart, addToCart, setQty, cartKey, type CartSake } from "@/lib/cart";
import { type SakeSize, priceFor, sizeLabel } from "@/lib/sizes";
import { T } from "@/components/T";
import { haptic } from "@/lib/haptics";

// サイズ選択シート（グラス90ml / 1合180ml / 熱燗1合）。
// ＋タップで毎回このシートを開く＝サイズの取り違え・誤注文を防ぐ。
// 熱燗は kanOk の銘柄だけに出す（1合徳利のみ・価格はグラス×2）。
// 一覧カードでは <Link> の中に置かれるため、シート内のタップは preventDefault/stopPropagation で
// 親リンクのページ遷移を止める（止めないと「＋を押したら詳細ページに飛ぶ」事故になる）。
export function SizePicker({
  sake,
  kanOk = false,
  open,
  onClose,
}: {
  sake: CartSake;
  kanOk?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { lines } = useCart();
  if (!open) return null;

  const sizes: SakeSize[] = kanOk ? ["glass", "go", "kan"] : ["glass", "go"];
  const qtyOf = (size: SakeSize) => lines.find((l) => l.key === cartKey(sake.id, size))?.qty ?? 0;

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const add = (e: React.MouseEvent, size: SakeSize) => {
    stop(e);
    haptic(14);
    addToCart({ ...sake, size });
  };
  const dec = (e: React.MouseEvent, size: SakeSize) => {
    stop(e);
    haptic(8);
    setQty(cartKey(sake.id, size), qtyOf(size) - 1);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40"
      onClick={(e) => {
        stop(e);
        onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-3xl bg-paper px-5 pb-[calc(env(safe-area-inset-bottom)_+_24px)] pt-5" onClick={stop}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hairline" />
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-[16px] font-bold">
            🍶 {sake.brand}
            {sake.grade ? <span className="ml-1 text-xs font-normal text-ink-soft">{sake.grade}</span> : null}
          </h2>
          <button
            onClick={(e) => {
              stop(e);
              onClose();
            }}
            className="shrink-0 text-sm text-ink-soft"
          >
            <T ja="閉じる" en="Close" />
          </button>
        </div>
        <p className="mb-2 text-[11.5px] text-ink-soft">
          <T ja="サイズをお選びください（1合はグラス2杯ぶん）" en="Choose a size (one gō = two glasses)" />
        </p>

        <div className="space-y-2">
          {sizes.map((size) => {
            const qty = qtyOf(size);
            const price = sake.price != null ? priceFor(sake.price, size) : null;
            return (
              <div key={size} className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {size === "kan" ? "🔥 " : ""}
                    <T ja={sizeLabel(size, "ja")} en={sizeLabel(size, "en")} />
                  </p>
                  {size === "kan" && (
                    <p className="text-[10.5px] text-ink-soft">
                      <T ja="1合徳利でのご提供です" en="Served warm in a gō tokkuri" />
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-bold">{price != null ? `¥${price.toLocaleString()}` : "¥—"}</span>
                {qty === 0 ? (
                  <button
                    onClick={(e) => add(e, size)}
                    aria-label={`${sake.brand}（${sizeLabel(size, "ja")}）を注文に追加`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss text-lg leading-none text-white active:scale-90"
                  >
                    ＋
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center rounded-full bg-moss px-1 text-white">
                    <button onClick={(e) => dec(e, size)} aria-label="1つ減らす" className="flex h-9 w-8 items-center justify-center text-lg leading-none active:scale-90">
                      −
                    </button>
                    <span className="min-w-[1.1ch] px-0.5 text-center text-sm font-bold tabular-nums">{qty}</span>
                    <button onClick={(e) => add(e, size)} aria-label="1つ増やす" className="flex h-9 w-8 items-center justify-center text-lg leading-none active:scale-90">
                      ＋
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={(e) => {
            stop(e);
            onClose();
          }}
          className="mt-4 w-full rounded-full bg-moss-deep py-3.5 text-[14px] font-bold text-white active:scale-[0.99]"
        >
          <T ja="OK（カートへ）" en="Done" />
        </button>
      </div>
    </div>
  );
}
