"use client";

import { useEffect, useState } from "react";
import { useCart, setQty, clearCart, currentTable, orderingUiEnabled, cartKey } from "@/lib/cart";
import { normalizeSize, priceFor, sizeLabel } from "@/lib/sizes";
import { Mascot } from "@/components/Mascot";
import { T } from "@/components/T";
import { haptic } from "@/lib/haptics";

type Phase = "idle" | "sending" | "done" | "error";
type Done = {
  names: string[]; // 注文した銘柄
  unresolved: number; // 一部の銘柄が注文できなかった本数（#19 部分成功）
};

// 画面下の注文フッターバー＋カートドロワー。
// 注文UIが有効（NEXT_PUBLIC_ORDERING_ENABLED=1）かつ卓QRで来ているときだけ出る。
// 2026-10-01: 図鑑登録・酒神のご開帳・ランク昇格の演出をやめ、注文後は「ありがとうございます」だけ出す。
export function CartBar() {
  const { lines, count, total } = useCart();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  // 杯数が増えた直後の「入れました」表示（2026-10-30 オーナー指摘「この部分が気づかない」）。
  // 一覧に戻ったときにバーが跳ねて、上に小さな確認が 2 秒出る
  const [flash, setFlash] = useState(0);
  const [prevCount, setPrevCount] = useState(count);
  if (count !== prevCount) {
    setPrevCount(count);
    if (count > prevCount) setFlash(Date.now());
  }
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(0), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  // お礼の表示は数秒で自動的に閉じる（残り続けない）
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 5000);
    return () => clearTimeout(t);
  }, [phase]);

  const table = currentTable();
  if (!orderingUiEnabled() || !table) return null;
  if (count === 0 && phase !== "done") return null;

  async function submit() {
    setPhase("sending");
    setMsg("");
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines.map((l) => ({ sakeId: l.item.id, quantity: l.qty, size: l.item.size })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMsg(j?.message || "注文を送れませんでした。スタッフにお声がけください。");
        return;
      }
      haptic([0, 18, 30, 24]);
      const ordered = (j.ordered || []) as { sakeId: number; quantity: number; size?: string; brand?: string }[];
      const unresolvedItems = (j.unresolved || []) as { sakeId: number; brand?: string }[];
      setDone({ names: ordered.map((o) => o.brand || "").filter(Boolean), unresolved: unresolvedItems.length });
      // #19: 注文できた分だけカートから消す。未注文（unresolved）はカートに残してスタッフ対応へ
      if (unresolvedItems.length) {
        for (const o of ordered) setQty(cartKey(o.sakeId, normalizeSize(o.size)), 0);
      } else {
        clearCart();
      }
      setOpen(false);
      setPhase("done");
    } catch {
      setPhase("error");
      setMsg("通信に失敗しました。電波の良い場所で再度お試しください。");
    }
  }

  if (phase === "done" && done) {
    const extra = done.names.length - 1;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-7" onClick={() => setPhase("idle")}>
        <div
          className="relative w-full max-w-xs rounded-3xl p-6 text-center text-white"
          style={{ background: "linear-gradient(155deg,#1f4636,#0e2a20)", boxShadow: "0 20px 50px rgba(0,0,0,.45), inset 0 0 0 1px #caa86a55" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Mascot size={64} className="mx-auto mb-2" fallback={<span className="text-[44px]">🍶</span>} />
          <p className="text-[17px] font-extrabold"><T ja="ご注文ありがとうございます" en="Thank you for your order" /></p>
          <p className="mt-1 truncate text-[12px] text-white/75">
            {done.names[0]}
            {extra > 0 ? ` ほか${extra}本` : ""}
          </p>
          <p className="mt-2 text-[11.5px] text-white/70"><T ja="キッチンにお伝えしました。少々お待ちください。" en="Sent to the kitchen. It will be with you shortly." /></p>
          {done.unresolved ? (
            <p className="mt-2 rounded-lg bg-[#caa86a]/20 px-2.5 py-1.5 text-[11px] text-[#f0dcae]">
              <T
                ja={`${done.unresolved}本はご注文できませんでした。カートに残しています（スタッフへお声がけください）。`}
                en={`${done.unresolved} ${done.unresolved === 1 ? "drink" : "drinks"} couldn't be ordered. They're kept in your cart — please ask a staff member.`}
              />
            </p>
          ) : null}
          <button onClick={() => setPhase("idle")} className="mt-4 w-full rounded-full bg-[#caa86a] py-3 text-[13.5px] font-bold text-[#16352a] active:scale-95">
            🍶 <T ja="つづけて選ぶ" en="Keep browsing" />
          </button>
        </div>
      </div>
    );
  }
  if (phase === "done") return null;

  return (
    <>
      {/* フッターバー（2 段: 上に杯数と金額、下に大きな金色の「注文を確認する」ボタン。
          薄い緑の画面に対して濃い緑＋金で目立たせる。追加直後は跳ねて「カートに入れました」が出る） */}
      <div
        key={flash || "bar"}
        className={`fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg rounded-t-3xl bg-moss-deep px-4 pb-[calc(env(safe-area-inset-bottom)_+_14px)] pt-3 text-white shadow-[0_-6px_24px_rgba(0,0,0,0.35)] ${flash ? "cartbar-pop" : ""}`}
        style={{ boxShadow: "0 -6px 24px rgba(0,0,0,.35), inset 0 1px 0 #caa86a66" }}
      >
        {flash ? (
          <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
            <div className="whitespace-nowrap rounded-full bg-[#caa86a] px-4 py-1.5 text-[13px] font-extrabold text-[#16352a] shadow-[0_4px_14px_rgba(0,0,0,.3)] cartbar-toast">
              ✓ <T ja="カートに入れました" en="Added to cart" />
            </div>
          </div>
        ) : null}
        <button onClick={() => setOpen(true)} className="flex w-full items-center justify-between px-1 pb-2.5 text-left">
          <span className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-[20px]">
              🍶
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#caa86a] px-1 text-[11px] font-extrabold text-[#16352a]">{count}</span>
            </span>
            <span className="text-[15px] font-extrabold">
              <T ja={`${count}杯 カートに入っています`} en={`${count} ${count === 1 ? "drink" : "drinks"} in your cart`} />
              <span className="ml-2 text-[12px] font-normal text-white/70"><T ja={`${table}卓`} en={`Table ${table}`} /></span>
            </span>
          </span>
          <span className="text-[16px] font-extrabold tabular-nums">¥{total.toLocaleString()}</span>
        </button>
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#caa86a] py-3.5 text-[15px] font-extrabold tracking-wider text-[#16352a] shadow-[0_3px_0_#8a6f3f] active:translate-y-[2px] active:shadow-none"
        >
          <T ja="注文内容を確認する" en="Review & order" /> ›
        </button>
      </div>

      {/* ドロワー */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-paper px-5 pb-8 pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline" />
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold"><T ja={`ご注文（${table}卓）`} en={`Your Order (Table ${table})`} /></h2>
              <button onClick={() => setOpen(false)} className="text-sm text-ink-soft">
                <T ja="閉じる" en="Close" />
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {l.item.brand}
                      {l.item.grade ? <span className="ml-1 text-xs font-normal text-ink-soft">{l.item.grade}</span> : null}
                    </p>
                    {/* サイズ（グラス/1合/熱燗）と、そのサイズの単価（1合・熱燗=グラス×2） */}
                    <p className="text-[11px] text-ink-soft">
                      {l.item.size === "kan" ? "🔥 " : ""}
                      <T ja={sizeLabel(l.item.size, "ja")} en={sizeLabel(l.item.size, "en")} />
                      {" ・ ¥"}
                      {priceFor(l.item.price || 0, l.item.size).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => setQty(l.key, l.qty - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-lg">
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                    <button onClick={() => setQty(l.key, l.qty + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-lg">
                      ＋
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink-soft"><T ja={`合計（${count}杯）`} en={`Total (${count} ${count === 1 ? "drink" : "drinks"})`} /></span>
              <span className="text-lg font-bold">¥{total.toLocaleString()}</span>
            </div>

            {phase === "error" && (
              <p className="mt-3 rounded-xl bg-[#fbeceb] px-3 py-2 text-center text-xs text-[#b3261e]">
                {msg === "注文を送れませんでした。スタッフにお声がけください。" ? (
                  <T ja={msg} en="We couldn't send your order. Please ask a staff member." />
                ) : msg === "通信に失敗しました。電波の良い場所で再度お試しください。" ? (
                  <T ja={msg} en="Connection failed. Please move to an area with better signal and try again." />
                ) : (
                  msg
                )}
              </p>
            )}

            <button
              onClick={submit}
              disabled={phase === "sending" || count === 0}
              className="mt-4 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white disabled:opacity-50"
            >
              {phase === "sending" ? <T ja="注文中…" en="Ordering…" /> : <T ja="この一杯を注文" en="Order this cup" />}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-soft">
              <T ja="キッチンに直接届きます" en="Sent straight to the kitchen" />
            </p>
          </div>
        </div>
      )}
    </>
  );
}
