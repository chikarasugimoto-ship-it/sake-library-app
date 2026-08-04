"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Item = {
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: string;
  checked: boolean;
};

async function resizeForAI(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height)); // メニューは文字が小さいので長辺大きめ
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

export default function MenuScan() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "review" | "saving">("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setPhase("scanning");
    try {
      const base64 = await resizeForAI(file);
      const res = await fetch("/api/admin/recognize-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, media_type: "image/jpeg" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || "メニュー認識に失敗しました");
        setPhase("idle");
        return;
      }
      const j = (await res.json()) as { items: Omit<Item, "checked" | "price">[] & { price: number | null }[] };
      const list: Item[] = (j.items as unknown as { brand: string; sub_name: string; brewery: string; prefecture: string; grade: string; price: number | null }[]).map((it) => ({
        brand: it.brand,
        sub_name: it.sub_name,
        brewery: it.brewery,
        prefecture: it.prefecture,
        grade: it.grade,
        price: it.price != null ? String(it.price) : "",
        checked: true,
      }));
      setItems(list);
      setPhase(list.length ? "review" : "idle");
      if (!list.length) setError("日本酒を読み取れませんでした。もう少し鮮明に撮ってください。");
    } catch {
      setError("画像の処理に失敗しました");
      setPhase("idle");
    }
  }

  function upd(i: number, patch: Partial<Item>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function saveAll() {
    const chosen = items.filter((it) => it.checked && it.brand.trim());
    if (!chosen.length) return;
    setPhase("saving");
    setProgress({ done: 0, total: chosen.length });
    for (let i = 0; i < chosen.length; i++) {
      const it = chosen[i];
      await fetch("/api/admin/sakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: it.brand,
          sub_name: it.sub_name,
          brewery: it.brewery,
          prefecture: it.prefecture,
          grade: it.grade,
          price: it.price ? Number(it.price) : null,
        }),
      }).catch(() => {});
      setProgress({ done: i + 1, total: chosen.length });
    }
    router.push("/admin");
    router.refresh();
  }

  const chosenCount = items.filter((it) => it.checked).length;

  return (
    <main className="mx-auto max-w-lg pb-24">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin/new" className="text-xs text-ink-soft">‹ 1本ずつ登録に戻る</Link>
        <h1 className="mt-2 text-2xl font-bold">メニューから一括登録</h1>
        <p className="mt-1 text-xs text-ink-soft">品書きを撮るだけ。載っている日本酒をAIがまとめて読み取ります。</p>
      </header>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />

      {phase === "idle" && (
        <div className="px-6">
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-3xl bg-gradient-to-br from-[#23262a] to-[#101214] text-white"
          >
            <span className="text-4xl">🗒</span>
            <span className="text-sm font-semibold">品書きを撮影する</span>
            <span className="text-[11px] text-white/50">日本酒のページ全体が入るように</span>
          </button>
          {error && <p className="mt-3 text-center text-xs text-[#b04a3a]">{error}</p>}
        </div>
      )}

      {phase === "scanning" && (
        <div className="mx-6 mt-4 flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-3xl bg-[#101214]">
          <p className="animate-pulse text-sm text-white/80">品書きを読み取っています…</p>
          <p className="text-[11px] text-white/40">手書き・崩し字も解析中</p>
        </div>
      )}

      {phase === "review" && (
        <div className="px-5">
          <p className="px-1 text-xs text-moss-deep">
            <b>{items.length}件</b>の日本酒を検出。内容を確認して、登録する銘柄にチェック。
          </p>
          {error && <p className="mt-1 px-1 text-xs text-[#b04a3a]">{error}</p>}
          <div className="mt-3 space-y-2">
            {items.map((it, i) => (
              <div key={i} className={`rounded-2xl bg-card p-3 shadow-[0_1px_3px_rgba(38,40,43,0.06)] ${it.checked ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={it.checked} onChange={(e) => upd(i, { checked: e.target.checked })} className="h-5 w-5 accent-[#1e3d2f]" />
                  <input value={it.brand} onChange={(e) => upd(i, { brand: e.target.value })} placeholder="銘柄" className="flex-1 bg-transparent text-sm font-bold outline-none" />
                  <input value={it.price} onChange={(e) => upd(i, { price: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="¥" className="w-16 rounded bg-paper px-2 py-1 text-right text-xs outline-none" />
                </div>
                <div className="mt-1.5 flex gap-1.5 pl-7">
                  <input value={it.brewery} onChange={(e) => upd(i, { brewery: e.target.value })} placeholder="酒蔵" className="w-1/3 rounded bg-paper px-2 py-1 text-[11px] outline-none" />
                  <input value={it.prefecture} onChange={(e) => upd(i, { prefecture: e.target.value })} placeholder="県" className="w-1/4 rounded bg-paper px-2 py-1 text-[11px] outline-none" />
                  <input value={it.grade} onChange={(e) => upd(i, { grade: e.target.value })} placeholder="特定名称" className="flex-1 rounded bg-paper px-2 py-1 text-[11px] outline-none" />
                </div>
              </div>
            ))}
          </div>
          <div className="sticky bottom-4 mt-5 flex gap-3">
            <button onClick={() => { setPhase("idle"); setItems([]); }} className="rounded-full border border-hairline bg-card px-5 py-4 text-sm text-ink-soft">撮り直す</button>
            <button onClick={saveAll} disabled={!chosenCount} className="flex-1 rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white shadow-[0_10px_26px_rgba(30,61,47,0.35)] disabled:opacity-40">
              選んだ {chosenCount} 件を登録
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-ink-soft">登録した銘柄はスマレジにも自動で商品作成されます</p>
        </div>
      )}

      {phase === "saving" && (
        <div className="px-6 pt-10 text-center">
          <p className="text-sm font-bold">登録中… {progress.done} / {progress.total}</p>
          <div className="mx-auto mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-[#e7e6e1]">
            <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
    </main>
  );
}
