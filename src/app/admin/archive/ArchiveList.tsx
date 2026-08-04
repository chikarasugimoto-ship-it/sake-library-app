"use client";

import { useState } from "react";
import { photoUrl } from "@/lib/types";

type ItemType = "deleted" | "soldout";
type Item = { id: number; brand: string; grade: string; hasPhoto: boolean; labelColor: string; type: ItemType; date: string };

// 'YYYY-MM-DD HH:MM:SS' → 'M月D日 HH:MM'
function fmt(ts: string): string {
  const m = ts.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return "";
  return `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}

export function ArchiveList({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);

  async function restore(s: Item) {
    const what = s.type === "deleted" ? "消去した" : "売切れの";
    if (!confirm(`${what}「${s.brand}」を在庫ボードに戻しますか？\n「提供中」で復活します。`)) return;
    setBusy(s.id);
    const prev = items;
    setItems((list) => list.filter((i) => i.id !== s.id)); // 楽観的に消す
    // 消去（archived）は archived=false で復元、売切れは status=available で提供中へ
    const body = s.type === "deleted" ? { archived: false } : { status: "available" };
    const res = await fetch(`/api/admin/sakes/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setItems(prev); // 失敗時は戻す
    setBusy(null);
  }

  if (items.length === 0) {
    return (
      <p className="px-6 py-20 text-center text-sm text-ink-soft">
        在庫から外した日本酒はありません。
        <br />
        売切れ（翌日）と🗑消去したものがここに残ります。
      </p>
    );
  }

  return (
    <div className="space-y-2.5 px-4">
      <p className="px-2 pb-1 text-[11px] text-ink-soft">{items.length} 件（新しい順）</p>
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
          <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md bg-[#f1efe9]">
            {s.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl(s.id, s.date)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full" style={{ background: s.labelColor }} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  s.type === "deleted" ? "bg-[#fbeceb] text-[#b3261e]" : "bg-[#f0ede6] text-[#80868c]"
                }`}
              >
                {s.type === "deleted" ? "消去" : "売切れ"}
              </span>
              <p className="truncate text-sm font-bold">
                {s.brand}
                {s.grade && <span className="ml-1 font-normal text-ink-soft">{s.grade}</span>}
              </p>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-soft">
              {fmt(s.date)} {s.type === "deleted" ? "に消去" : "に売切れ"}
            </p>
          </div>
          <button
            onClick={() => restore(s)}
            disabled={busy === s.id}
            className="shrink-0 rounded-full border border-moss bg-card px-4 py-2 text-[12px] font-bold text-moss-deep disabled:opacity-50"
          >
            {busy === s.id ? "戻し中…" : "↩ 戻す"}
          </button>
        </div>
      ))}
    </div>
  );
}
