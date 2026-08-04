"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Item = { id: number; menuName: string; price: number | null; linked: boolean };
type Data = { total: number; linked: number; unlinked: number; items: Item[] };

export function LinkStatus() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/smaregi-link-status", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        setErr(j?.error === "smaregi_unconfigured" ? "スマレジが未設定です" : "取得に失敗しました（時間をおいて再読込）");
      } else {
        setData(j);
      }
    } catch {
      setErr("通信に失敗しました");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function copy(item: Item) {
    try {
      await navigator.clipboard.writeText(item.menuName);
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1400);
    } catch {
      // クリップボード不可の環境は何もしない（名前は画面に表示済み）
    }
  }

  const unlinked = data?.items.filter((i) => !i.linked) ?? [];
  const linked = data?.items.filter((i) => i.linked) ?? [];

  return (
    <main className="mx-auto max-w-lg pb-28">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-[12px] text-ink-soft">‹ 在庫ボード</Link>
        <p className="mt-3 text-[11px] font-bold tracking-[0.3em] text-ink-soft">SMAREGI</p>
        <h1 className="mt-1 text-2xl font-bold">スマレジ連携状況</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          会計レシートを<b className="text-moss-deep">銘柄ごとに分けて印字</b>するための設定です。
        </p>
      </header>

      <div className="mx-6 my-3 rounded-2xl border border-hairline bg-card p-4 text-[12px] leading-relaxed text-[#3c3f44]">
        <p className="font-bold text-moss-deep">やること（一度だけ）</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>スマレジ・<b>ウェイター管理画面</b>を開く</li>
          <li>下の「<b>未登録</b>」の銘柄を、メニュー名を<b>そのままコピーして</b>「オープン価格」で1つずつ登録</li>
          <li>登録後この画面を<b>再読込</b>すると ✓ に変わります</li>
        </ol>
        <p className="mt-2 rounded-xl bg-[#eef3ef] px-3 py-2 text-[11.5px] text-ink-soft">
          価格はアプリが自動で送るので<b className="text-moss-deep">ウェイター側の価格設定は不要</b>（価格改定しても触らなくてOK）。
          未登録の銘柄も注文は通りますが、同額の他銘柄と会計でまとまります。
        </p>
      </div>

      <div className="mx-6 mb-3 flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="rounded-full border border-moss px-3.5 py-2 text-[11.5px] font-bold text-moss disabled:opacity-50"
        >
          {loading ? "読込中…" : "再読込"}
        </button>
        {data && (
          <span className="text-[11.5px] text-ink-soft">
            連携済 <b className="text-moss-deep">{data.linked}</b> / 未登録{" "}
            <b className={data.unlinked ? "text-[#b04a3a]" : "text-moss-deep"}>{data.unlinked}</b>（計{data.total}）
          </span>
        )}
      </div>

      {err && <p className="mx-6 rounded-xl bg-[#fbece9] px-4 py-3 text-[12px] text-[#b04a3a]">{err}</p>}

      {unlinked.length > 0 && (
        <section className="mt-2">
          <h2 className="px-6 text-[11px] font-bold tracking-[0.14em] text-[#b04a3a]">✗ 未登録（ウェイターに作成）</h2>
          <div className="mt-2 space-y-2 px-4">
            {unlinked.map((it) => (
              <div key={it.id} className="flex items-center gap-3 rounded-2xl border border-[#f0d9d3] bg-card px-4 py-3 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{it.menuName}</p>
                  <p className="text-[11px] text-ink-soft">{it.price != null ? `¥${it.price.toLocaleString()}` : "価格未設定"}</p>
                </div>
                <button
                  onClick={() => copy(it)}
                  className="shrink-0 rounded-full bg-moss-deep px-3.5 py-2 text-[11.5px] font-bold text-white active:scale-95"
                >
                  {copied === it.id ? "コピー✓" : "名前をコピー"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {linked.length > 0 && (
        <section className="mt-6">
          <h2 className="px-6 text-[11px] font-bold tracking-[0.14em] text-moss">✓ 連携済（レシートで銘柄別に印字）</h2>
          <div className="mt-2 space-y-1.5 px-4">
            {linked.map((it) => (
              <div key={it.id} className="flex items-center gap-3 rounded-xl bg-[#eef3ef] px-4 py-2.5">
                <span className="text-moss">✓</span>
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{it.menuName}</p>
                <span className="text-[11px] text-ink-soft">{it.price != null ? `¥${it.price.toLocaleString()}` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && data.total === 0 && (
        <p className="px-6 py-14 text-center text-sm text-ink-soft">登録中の日本酒がありません。</p>
      )}
    </main>
  );
}
