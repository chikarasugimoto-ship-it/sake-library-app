"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, setQty, clearCart, currentTable, orderingUiEnabled } from "@/lib/cart";
import { useCollection, rankFor, nextRank } from "@/lib/collection";
import { rarityRank, type Rarity } from "@/lib/sakegami";
import { SakegamiReveal } from "./SakegamiReveal";
import { Mascot } from "@/components/Mascot";
import { T } from "@/components/T";
import { haptic } from "@/lib/haptics";

type Phase = "idle" | "sending" | "reveal" | "done" | "error";
type Reveal = { name: string; rarity: string; artUrl: string | null; extra: number };
type Celebration = {
  names: string[]; // 注文した銘柄
  newKinds: number; // 今回あらたに図鑑入りした種類数
  collected: number; // 集めた種類数（合計）
  rankIcon: string;
  rankName: string;
  nextName?: string;
  nextRemaining?: number;
  leveledUp: boolean; // 今回ランクが上がったか
  unresolved?: number; // 一部の銘柄が注文できなかった本数（#19 部分成功）
};

// 全画面共通の注文フッターバー＋カートドロワー。
// 注文UIが有効（NEXT_PUBLIC_ORDERING_ENABLED=1）かつ卓QRで来ているときだけ出る。
export function CartBar() {
  const router = useRouter();
  const { lines, count, total } = useCart();
  const { tasted, markTasted } = useCollection();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [cel, setCel] = useState<Celebration | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  // お祝い表示は数秒で自動的に閉じる（残り続けない）。ボタンですぐ閉じる/図鑑へも行ける。
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 6000);
    return () => clearTimeout(t);
  }, [phase]);

  function closeCelebration() {
    setPhase("idle");
    setOpen(false);
  }

  const table = currentTable();
  if (!orderingUiEnabled() || !table) return null;
  if (count === 0 && phase !== "done" && phase !== "reveal") return null;

  async function submit() {
    setPhase("sending");
    setMsg("");
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lines.map((l) => ({ sakeId: l.item.id, quantity: l.qty })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMsg(j?.message || "注文を送れませんでした。スタッフにお声がけください。");
        return;
      }
      // 注文成功 → 神おろしへ（手応えのハプティック）
      haptic([0, 18, 30, 24]);
      // 図鑑に登録（種類1回だけ・重複しない・杯数は数えない）。お祝い情報を作る
      const ordered = (j.ordered || []) as { sakeId: number; quantity: number; brand?: string }[];
      const unresolvedItems = (j.unresolved || []) as { sakeId: number; brand?: string }[];
      const before = tasted.size;
      const newKinds = ordered.filter((o) => !tasted.has(o.sakeId)).length;
      const collected = before + newKinds;
      const rk = rankFor(collected);
      const nx = nextRank(collected);
      setCel({
        names: ordered.map((o) => o.brand || "").filter(Boolean),
        newKinds,
        collected,
        rankIcon: rk.icon,
        rankName: rk.name,
        nextName: nx?.rank.name,
        nextRemaining: nx?.remaining,
        leveledUp: rankFor(before).min !== rk.min,
        unresolved: unresolvedItems.length,
      });
      const newIds = ordered.filter((o) => !tasted.has(o.sakeId)).map((o) => o.sakeId);
      for (const o of ordered) markTasted(o.sakeId);
      // #19: 注文できた分だけカートから消す。未注文（unresolved）はカートに残してスタッフ対応へ
      if (unresolvedItems.length) {
        for (const o of ordered) setQty(o.sakeId, 0);
      } else {
        clearCart();
      }
      setOpen(false);

      // ご開帳：新しく図鑑入りした酒神獣のうち、最高レア度の1体を演出。なければ通常のお祝いへ。
      let revealed = false;
      if (newIds.length) {
        try {
          const gr = await fetch(`/api/sakes?ids=${newIds.join(",")}`, { cache: "no-store" });
          if (gr.ok) {
            const items = ((await gr.json()).sakes || []) as { id: number; brand: string; rarity?: string; godName?: string; hasArt?: boolean }[];
            const withR = items.filter((x) => x.rarity);
            if (withR.length) {
              withR.sort((a, b) => rarityRank(b.rarity as Rarity) - rarityRank(a.rarity as Rarity));
              const top = withR[0];
              // キャラ絵が無い銘柄は額の中がグラデ placeholder になる（/api/god-art は絵無しだと404＝壊れ画像になるため null を渡す）
              const gurl = top.hasArt ? `/api/god-art/${top.id}` : null;
              // キャラ画像を読み込み切ってから儀式を始める（色が差す瞬間に絵が確実に出る。待ちすぎ防止に最大2.5秒）
              if (gurl) {
                await new Promise<void>((resolve) => {
                  let settled = false;
                  const done = () => { if (!settled) { settled = true; resolve(); } };
                  try {
                    const im = new window.Image();
                    im.onload = done;
                    im.onerror = done;
                    im.src = gurl;
                  } catch { done(); }
                  setTimeout(done, 2500);
                });
              }
              setReveal({ name: top.godName || top.brand, rarity: top.rarity as string, artUrl: gurl, extra: newIds.length - 1 });
              setPhase("reveal");
              revealed = true;
            }
          }
        } catch {}
      }
      if (!revealed) setPhase("done");
    } catch {
      setPhase("error");
      setMsg("通信に失敗しました。電波の良い場所で再度お試しください。");
    }
  }

  // ご開帳：新しく獲得した酒神獣の出現演出（閉じると通常のお祝いへ）
  if (phase === "reveal" && reveal) {
    return (
      <SakegamiReveal
        name={reveal.name}
        rarity={reveal.rarity}
        artUrl={reveal.artUrl}
        extra={reveal.extra}
        onClose={() => setPhase("done")}
      />
    );
  }

  // 注文完了のお祝い：図鑑に入った＋ランクを動きのある演出で。すぐ注文に戻れる導線つき
  if (phase === "done" && cel) {
    const extra = cel.names.length - 1;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-7" onClick={closeCelebration}>
        <style>{`
          @keyframes cel-pop { from { opacity:0; transform: scale(.7) translateY(10px) } to { opacity:1; transform:none } }
          @keyframes cel-fly { 0% { opacity:0; transform: translate(-46px,-32px) scale(.6) rotate(-12deg) } 55% { opacity:1 } 100% { opacity:0; transform: translate(0,6px) scale(.5) } }
          @keyframes cel-plus { 0% { opacity:0; transform: translateY(8px) scale(.8) } 30% { opacity:1 } 100% { opacity:0; transform: translateY(-26px) scale(1.1) } }
          @keyframes cel-spark { 0%,100% { opacity:.15; transform: scale(.6) } 50% { opacity:.85; transform: scale(1) } }
          @keyframes cel-num { from { opacity:0; transform: scale(.5) } to { opacity:1; transform: scale(1) } }
          @keyframes cel-fuda { 0% { opacity:0; transform: perspective(320px) rotateX(-88deg); background:#13241c } 55% { opacity:1; transform: perspective(320px) rotateX(10deg); background:#5a4a2a } 100% { opacity:1; transform: perspective(320px) rotateX(0); background:#e8d1a0 } }
          @media (prefers-reduced-motion: reduce){ .cel-fuda{ animation:none !important; opacity:1 !important; transform:none !important; background:#e8d1a0 !important } }
        `}</style>
        <div
          className="relative w-full max-w-xs overflow-hidden rounded-3xl p-6 text-center text-white"
          style={{ background: "linear-gradient(155deg,#1f4636,#0e2a20)", boxShadow: "0 20px 50px rgba(0,0,0,.45), inset 0 0 0 1px #caa86a55", animation: "cel-pop .5s cubic-bezier(.2,.9,.3,1.2) forwards" }}
          onClick={(e) => e.stopPropagation()}
        >
          {([["12%", "18%", "0.2s"], ["84%", "22%", "0.6s"], ["20%", "78%", "0.9s"], ["80%", "72%", "0.4s"]] as const).map(([l, t, d], i) => (
            <span key={i} className="pointer-events-none absolute h-1.5 w-1.5 rounded-full" style={{ left: l, top: t, background: "#e8d1a0", animation: `cel-spark 1.8s ease-in-out ${d} infinite` }} />
          ))}

          {/* すぎだまるが一緒にお祝い */}
          <Mascot size={56} className="mx-auto mb-1" />

          {/* 一杯が図鑑（本）に入っていくアニメ */}
          <div className="relative mx-auto mb-1 flex h-20 w-20 items-center justify-center">
            <span className="text-[52px] leading-none">📖</span>
            <span className="absolute text-[30px]" style={{ animation: "cel-fly 1.1s ease-in .15s both" }}>🍶</span>
            {cel.newKinds > 0 && (
              <span className="absolute -right-1 top-0 text-[18px] font-extrabold text-[#e8d1a0]" style={{ animation: "cel-plus 1.3s ease-out .5s both" }}>＋{cel.newKinds}</span>
            )}
          </div>

          <p className="text-[17px] font-extrabold" style={{ animation: "cel-pop .5s ease .25s both" }}>
            {cel.newKinds > 0 ? (
              <T ja="図鑑に登録しました！" en="Added to your collection!" />
            ) : (
              <T ja="また一杯、乾杯！" en="Cheers to another pour!" />
            )}
          </p>
          <p className="mt-1 truncate text-[12px] text-white/75">
            {cel.names[0]}
            {extra > 0 ? ` ほか${extra}本` : ""}
          </p>
          {cel.unresolved ? (
            <p className="mt-1.5 rounded-lg bg-[#caa86a]/20 px-2.5 py-1.5 text-[11px] text-[#f0dcae]">
              <T
                ja={`${cel.unresolved}本はご注文できませんでした。カートに残しています（スタッフへお声がけください）。`}
                en={`${cel.unresolved} ${cel.unresolved === 1 ? "drink" : "drinks"} couldn't be ordered. They're kept in your cart — please ask a staff member.`}
              />
            </p>
          ) : null}

          {/* ランク */}
          <div className="mt-4 rounded-2xl bg-white/10 p-3">
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl">{cel.rankIcon}</span>
              <span className="text-[15px] font-bold text-[#e8d1a0]">{cel.rankName}</span>
            </div>
            <div className="mt-1 text-[12px] text-white/80">
              <T ja="図鑑コレクション" en="Collection" />{" "}
              <b className="inline-block text-[16px] text-white" style={{ animation: "cel-num .5s ease .4s both" }}>{cel.collected}</b>{" "}
              <T ja="種" en="kinds" />
            </div>
            {cel.leveledUp ? (
              <div className="mt-2 flex justify-center" style={{ perspective: "320px" }}>
                <span className="cel-fuda inline-block rounded-md px-3 py-1.5 text-[12.5px] font-extrabold text-[#16352a]" style={{ transformOrigin: "center bottom", boxShadow: "0 6px 16px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,246,223,.6)", animation: "cel-fuda .9s cubic-bezier(.2,.8,.3,1.25) .35s both" }}>
                  <T ja={`「${cel.rankName}」に昇格！`} en={`Promoted to "${cel.rankName}"!`} />
                </span>
              </div>
            ) : cel.nextName ? (
              <p className="mt-1 text-[11px] text-white/65"><T ja={`あと ${cel.nextRemaining} 種で「${cel.nextName}」`} en={`${cel.nextRemaining} more to reach "${cel.nextName}"`} /></p>
            ) : (
              <p className="mt-1 text-[11px] font-bold text-[#e8d1a0]"><T ja="🏆 殿堂入り達成！" en="🏆 Hall of Fame reached!" /></p>
            )}
          </div>

          {/* 導線：①酒神をシェア（拡散）②図鑑をひらく ③つづけて注文（すぐ注文に戻れる） */}
          <button
            onClick={() => { setPhase("idle"); router.push("/zukan?share=1"); }}
            className="mt-4 w-full rounded-full bg-[#caa86a] py-3 text-[13.5px] font-bold text-[#16352a] active:scale-95"
          >
            📸 {cel.newKinds > 0 ? <T ja="獲得した酒神をシェア" en="Share your new sake god" /> : <T ja="図鑑をシェアする" en="Share my collection" />}
          </button>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { setPhase("idle"); router.push("/zukan"); }}
              className="flex-1 rounded-full bg-white/15 py-3 text-[13px] font-bold text-white active:scale-95"
            >
              📖 <T ja="図鑑をひらく" en="Collection" />
            </button>
            <button onClick={closeCelebration} className="flex-1 rounded-full bg-white/15 py-3 text-[13px] font-bold text-white active:scale-95">
              🍶 <T ja="つづけて注文" en="Order more" />
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (phase === "done") return null; // 保険（祝い情報が無いとき）

  return (
    <>
      {/* フッターバー */}
      <button
        onClick={() => setOpen(true)}
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)_+_80px)] z-40 mx-auto flex max-w-lg items-center justify-between rounded-t-2xl bg-moss px-6 py-4 text-white shadow-[0_-3px_16px_rgba(0,0,0,0.20)]"
      >
        <span className="text-sm font-bold">
          <T ja={`${count}杯 をカートに`} en={`${count} ${count === 1 ? "drink" : "drinks"} in cart`} />
          <span className="ml-2 font-normal text-white/80"><T ja={`${table}卓`} en={`Table ${table}`} /></span>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-bold">¥{total.toLocaleString()}</span>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold"><T ja="確認する ›" en="Review ›" /></span>
        </span>
      </button>

      {/* ドロワー */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-t-3xl bg-paper px-5 pb-8 pt-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline" />
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold"><T ja={`ご注文（${table}卓）`} en={`Your Order (Table ${table})`} /></h2>
              <button onClick={() => setOpen(false)} className="text-sm text-ink-soft">
                <T ja="閉じる" en="Close" />
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.item.id} className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {l.item.brand}
                      {l.item.grade ? <span className="ml-1 text-xs font-normal text-ink-soft">{l.item.grade}</span> : null}
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      ¥{(l.item.price || 0).toLocaleString()} / {l.item.volume || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setQty(l.item.id, l.qty - 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-lg"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                    <button
                      onClick={() => setQty(l.item.id, l.qty + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-lg"
                    >
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
              <T ja="キッチンに直接届きます ・ 飲んだ記録は図鑑に自動登録" en="Sent straight to the kitchen · Every pour is logged to your collection" />
            </p>
          </div>
        </div>
      )}
    </>
  );
}
