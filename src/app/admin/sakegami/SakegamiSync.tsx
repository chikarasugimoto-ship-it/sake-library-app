"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { RARITIES, RARITY_META, type Rarity } from "@/lib/sakegami";
import { SakegamiReveal } from "@/components/SakegamiReveal";

type GodRow = { sake_id: number; name: string; rarity: string; kuchijo: string; region8: string; brand: string; grade: string; prefecture: string; brewery: string; has_art?: number; god_updated?: string };
type Summary = { total: number; aiUsed: boolean; aiNamed: number; prefBackfilled: number; breweryBackfilled: number; withRegion: number; byRarity: Record<string, number> };
type ArtStatus = { configured: boolean; total: number; done: number; remaining: number; unoptimized?: number };
type Status = { configured: boolean; total: number; done: number; remaining: number };

function Badge({ rarity }: { rarity: string }) {
  const m = RARITY_META[rarity as Rarity] || RARITY_META.N;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: m.bg, color: m.color }}>
      {rarity}・{m.jp}
    </span>
  );
}

export function SakegamiSync() {
  const [rows, setRows] = useState<GodRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [art, setArt] = useState<ArtStatus | null>(null);
  const [blob, setBlob] = useState<Status | null>(null);
  const [trans, setTrans] = useState<Status | null>(null);
  const [artBusy, setArtBusy] = useState(false);
  const [artErr, setArtErr] = useState("");
  const [compMsg, setCompMsg] = useState("");
  const [transMsg, setTransMsg] = useState("");
  const [preview, setPreview] = useState<GodRow | null>(null);
  const [showAdv, setShowAdv] = useState(false);

  async function load() {
    // 進捗系をまとめて取得（メンテナンスボタンの「完了したら隠す」判定に使う）
    const getJson = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [g, a, b, t] = await Promise.all([
      getJson("/api/admin/sakegami-sync"),
      getJson("/api/admin/sakegami-art"),
      getJson("/api/admin/blob-migrate"),
      getJson("/api/admin/translate"),
    ]);
    if (g) setRows(g.gods || []);
    if (a) setArt(a);
    if (b) setBlob(b);
    if (t) setTrans(t);
  }
  useEffect(() => {
    load();
  }, []);

  // お試し1体（既存も上書き＝先頭の銘柄で画風を確認・課金は1枚分）。
  async function genOne() {
    setArtBusy(true);
    setArtErr("");
    try {
      const r = await fetch("/api/admin/sakegami-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 1, force: true }) });
      const j = await r.json();
      if (!r.ok) setArtErr(j?.message || "生成に失敗しました（OPENAI_API_KEY とモデルをご確認ください）");
      else if (j.generated === 0) setArtErr("生成できませんでした（キー/モデル/コンテンツポリシーをご確認ください）");
      else setArt((p) => ({ ...p, configured: true, total: j.total, done: j.done, remaining: j.remaining }));
    } catch {
      setArtErr("通信に失敗しました");
    }
    setArtBusy(false);
    load();
  }

  // モンスターで作り直す＝既存のキャラ絵を全消去してから、全銘柄を生成し直す。
  async function genRebuild() {
    if (!confirm("既存のキャラ絵をすべて消して、モンスターで作り直します。\n（生成ぶん再課金されます）よろしいですか？")) return;
    setArtBusy(true);
    setArtErr("");
    try {
      const c = await fetch("/api/admin/sakegami-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
      if (!c.ok) { setArtErr("クリアに失敗しました。もう一度お試しください。"); setArtBusy(false); return; }
      const cj = await c.json();
      setArt((p) => ({ ...p, configured: true, total: cj.total, done: cj.done, remaining: cj.remaining }));
    } catch {
      setArtErr("クリアの通信に失敗しました。もう一度お試しください。");
      setArtBusy(false);
      return;
    }
    setArtBusy(false);
    await genArt(); // クリア後、未生成(=全部)を順に生成
  }

  // キャラ絵をAI生成。**1体ずつ**（ラベル生成は重く2体だと60秒上限を超えるため）・残りが無くなるまで自動で続ける。
  // タイムアウト等の一時失敗は数回まで自動リトライ（進捗は1体ずつ保存済みなので取りこぼさない）。
  async function genArt() {
    setArtBusy(true);
    setArtErr("");
    let fails = 0;
    let prev = -1;
    while (true) {
      let j: { total: number; done: number; remaining: number; generated?: number; message?: string } | null = null;
      let ok = false;
      try {
        const r = await fetch("/api/admin/sakegami-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 1 }) });
        ok = r.ok;
        j = await r.json();
      } catch {
        j = null;
      }
      if (!j) {
        // 一時的な通信/タイムアウト失敗 → 少し待ってリトライ（遅い画像の取りこぼしを吸収・最大8回連続まで）
        fails++;
        if (fails >= 8) { setArtErr("通信が不安定です。少し待ってから『🐉 未生成ぶんを生成する』で再開してください（進捗は保存済み）。"); break; }
        await new Promise((res) => setTimeout(res, 2500));
        continue;
      }
      if (!ok) { setArtErr(j.message || "生成に失敗しました（OPENAI_API_KEY とモデルをご確認ください）"); break; }
      fails = 0;
      setArt((p) => ({ ...p, configured: true, total: j.total, done: j.done, remaining: j.remaining }));
      if (j.remaining <= 0) break;
      if (j.generated === 0 || j.remaining === prev) { setArtErr("ある銘柄で生成が止まりました（コンテンツポリシー等）。もう一度押すと続きから再開します。"); break; }
      prev = j.remaining;
    }
    setArtBusy(false);
    load();
  }

  // 既存のキャラ絵を 512px WebP に圧縮（絵は変えず・1回だけでOK）。表示を高速化。
  async function compressArt() {
    setArtBusy(true);
    setArtErr("");
    setCompMsg("");
    try {
      const r = await fetch("/api/admin/sakegami-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compress: true }) });
      const j = await r.json();
      if (!r.ok) setArtErr(j.error || "軽量化に失敗しました");
      else setCompMsg(`軽量化しました：${j.compressed}体（すでに軽量 ${j.skipped}体${j.failed?.length ? ` ・失敗 ${j.failed.length}体` : ""}）`);
    } catch {
      setArtErr("軽量化の通信に失敗しました");
    }
    setArtBusy(false);
    load();
  }

  // 既存の画像（日本酒の写真＋酒神キャラ絵）をCDN(Blob)へ移設＝表示を最速化。残りが無くなるまで自動で続ける。
  async function migrateBlob() {
    setArtBusy(true);
    setArtErr("");
    setCompMsg("");
    try {
      let total = 0;
      for (let guard = 0; guard < 200; guard++) {
        const r = await fetch("/api/admin/blob-migrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json();
        if (!r.ok) { setArtErr(j.error || "CDN移行に失敗しました"); break; }
        total += j.migrated || 0;
        setCompMsg(`CDN移行中… ${total}件完了（残り ${j.remaining}）`);
        if ((j.remaining ?? 0) <= 0) { setCompMsg(`✓ 画像をCDNへ移行しました（${total}件・残り0）`); break; }
        if ((j.migrated ?? 0) === 0) { setArtErr("移行が進みませんでした（失敗が続いています）。少し待って再度お試しください。"); break; }
      }
    } catch {
      setArtErr("CDN移行の通信に失敗しました");
    }
    setArtBusy(false);
    load();
  }

  // 日本酒情報をAIで英訳（インバウンド対応）。残りが無くなるまで自動で続ける。
  async function translateAll() {
    setArtBusy(true);
    setArtErr("");
    setTransMsg("");
    try {
      let total = 0;
      for (let guard = 0; guard < 200; guard++) {
        const r = await fetch("/api/admin/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await r.json();
        if (!r.ok) { setArtErr(j.error || "英訳に失敗しました"); break; }
        total += j.translated || 0;
        setTransMsg(`英訳中… ${total}件完了（残り ${j.remaining}）`);
        if ((j.remaining ?? 0) <= 0) { setTransMsg(`✓ 日本酒情報を英訳しました（${total}件・残り0）`); break; }
        if ((j.translated ?? 0) === 0) { setArtErr("英訳が進みませんでした。少し待って再度お試しください。"); break; }
      }
    } catch {
      setArtErr("英訳の通信に失敗しました");
    }
    setArtBusy(false);
    load();
  }

  async function run(aiNames: boolean) {
    if (!aiNames && !confirm("登録中の日本酒すべてに酒神メタ（レア度・地方・酒神名）を生成します。")) return;
    setBusy(true);
    setErr("");
    setSum(null);
    try {
      const r = await fetch("/api/admin/sakegami-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiNames }) });
      const j = await r.json();
      if (!r.ok) setErr(j?.error === "unauthorized" ? "権限がありません" : "生成に失敗しました（AI生成は時間がかかり失敗することがあります。レア度・地方は通常ボタンで確実に付きます）");
      else { setSum(j); load(); }
    } catch {
      setErr("通信に失敗しました（AI生成は時間切れになることがあります）");
    }
    setBusy(false);
  }

  // 一度きりメンテナンスの「やることが残っているか」。残り0なら該当ボタンは隠す。
  // 新しい日本酒を足すと未処理が出て自動的に再表示される（英訳・CDN移行）。
  const needCompress = (art?.unoptimized ?? 0) > 0;
  const needBlob = !!blob?.configured && (blob?.remaining ?? 0) > 0;
  const needTrans = !!trans?.configured && (trans?.remaining ?? 0) > 0;

  return (
    <main className="mx-auto max-w-lg pb-28">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-[12px] text-ink-soft">‹ 在庫ボード</Link>
        <p className="mt-3 text-[11px] font-bold tracking-[0.3em] text-ink-soft">SAKEGAMI</p>
        <h1 className="mt-1 text-2xl font-bold">酒神メタ 一括生成</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          各銘柄の<b className="text-moss-deep">レア度（N〜LR）・地方・酒神名・口上</b>を作ります。レア度と地方は価格・特定名称・産地から自動確定（抽選なし＝賭博性ゼロ）。産地/蔵元の空欄はAIが補完します。
        </p>
      </header>

      <div className="mx-6 mt-3">
        <button
          onClick={() => run(false)}
          disabled={busy}
          className="w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold tracking-wider text-white disabled:opacity-50"
        >
          {busy ? "生成中…" : "酒神メタを一括生成する（レア度・地方・名前）"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={busy}
          className="mt-2 w-full rounded-full border border-moss bg-card py-2.5 text-[12.5px] font-bold text-moss-deep disabled:opacity-50"
        >
          ✨ AIで酒神名を磨く（任意・時間がかかります／何度か押すと進みます）
        </button>
        {err && <p className="mt-3 rounded-xl bg-[#fbeceb] px-3 py-2 text-center text-[12px] text-[#b3261e]">{err}</p>}
        {sum && (
          <div className="mt-3 rounded-2xl border border-hairline bg-card p-4 text-[12px]">
            <p className="font-bold text-moss-deep">✓ {sum.total}銘柄にレア度・地方を生成しました</p>
            <p className="mt-1 text-ink-soft">
              地方判定 {sum.withRegion}/{sum.total} ・ 酒神名 {sum.aiNamed}/{sum.total} ・ 産地補完 {sum.prefBackfilled} ・ 蔵元補完 {sum.breweryBackfilled}
            </p>
            {sum.aiUsed && sum.aiNamed < sum.total && (
              <p className="mt-1.5 rounded-lg bg-[#eef3ef] px-2.5 py-1.5 text-[11px] text-moss-deep">
                酒神名がまだ全部に付いていません。<b>もう一度ボタンを押す</b>と続きの名前が付きます（レア度・地方は完了済み）。
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RARITIES.map((r) => (
                <span key={r} className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: RARITY_META[r].bg, color: RARITY_META[r].color }}>
                  {r} {sum.byRarity[r] || 0}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AIキャラ絵（OpenAI画像生成・ラベルからモンスター） */}
      <div className="mx-6 mt-4 rounded-2xl border border-hairline bg-card p-4">
        <p className="text-[13px] font-bold text-moss-deep">🐉 酒神獣（モンスター）をAIで生成</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">
          各銘柄の<b className="text-moss-deep">ラベルから</b>、その世界観のモンスターを描き、<b className="text-moss-deep">創作モンスター名</b>も付けます（高レア度ほど荘厳に）。1枚 約$0.04〜0.08。
          {!art?.configured && <b className="text-[#b3261e]">　OPENAI_API_KEY をVercelに設定すると使えます。</b>}
        </p>
        {art && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-ink-soft">
              <span>生成済み {art.done}/{art.total}</span>
              <span>{artBusy ? "生成中…（時間がかかります）" : art.remaining > 0 ? `あと ${art.remaining}` : "完了"}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-[#ecebe7]">
              <div className="h-full rounded-full bg-moss transition-[width] duration-500" style={{ width: `${art.total ? Math.round((art.done / art.total) * 100) : 0}%` }} />
            </div>
          </div>
        )}
        {/* 毎回の作業：未生成ぶんの生成 */}
        <button
          onClick={genArt}
          disabled={artBusy || !art?.configured || (!!art && art.remaining === 0)}
          className="mt-3 w-full rounded-full bg-moss-deep py-3 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {artBusy ? "生成中…" : art && art.remaining === 0 && art.done > 0 ? "✓ 未生成ぶんは完了" : "🐉 未生成ぶんを生成する"}
        </button>

        {/* 一度きりのメンテナンス：やることが残っている時だけ表示し、完了したら自動で隠れる
            （新しい日本酒を足すと英訳/CDN移行に未処理が出て自動で再表示される） */}
        {(needCompress || needBlob || needTrans) ? (
          <div className="mt-3 rounded-xl border border-hairline bg-[#f7f6f2] p-3">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">🛠 メンテナンス（必要な時だけ表示・完了で自動的に隠れます）</p>
            {needCompress && (
              <button
                onClick={compressArt}
                disabled={artBusy}
                className="mt-2 w-full rounded-full border border-moss bg-[#eef3ef] py-2.5 text-[12.5px] font-bold text-moss-deep disabled:opacity-50"
              >
                🗜 画像を軽量化して高速化（残り{art!.unoptimized}件・絵はそのまま）
              </button>
            )}
            {needBlob && (
              <button
                onClick={migrateBlob}
                disabled={artBusy}
                className="mt-2 w-full rounded-full bg-moss py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
              >
                🚀 画像をCDNへ移行（残り{blob!.remaining}件・写真＋酒神・最速化）
              </button>
            )}
            {needTrans && (
              <button
                onClick={translateAll}
                disabled={artBusy}
                className="mt-2 w-full rounded-full border border-moss bg-card py-2.5 text-[12.5px] font-bold text-moss-deep disabled:opacity-50"
              >
                🌐 日本酒情報をAIで英訳（残り{trans!.remaining}件・インバウンド対応）
              </button>
            )}
          </div>
        ) : (
          (art || blob || trans) && (
            <p className="mt-3 text-center text-[11px] text-ink-soft">✓ メンテナンス完了（軽量化・CDN移行・英訳とも処理待ちなし）</p>
          )
        )}
        {compMsg && <p className="mt-2 rounded-xl bg-[#eef3ef] px-3 py-2 text-center text-[12px] font-bold text-moss-deep">{compMsg}</p>}
        {transMsg && <p className="mt-2 rounded-xl bg-[#eef3ef] px-3 py-2 text-center text-[12px] font-bold text-moss-deep">{transMsg}</p>}

        {/* 上級者メニュー：既存を上書きする「押すと困る」操作はたたんでおく */}
        <button
          onClick={() => setShowAdv((v) => !v)}
          className="mt-3 w-full text-center text-[11px] text-ink-soft underline underline-offset-2"
        >
          {showAdv ? "上級者メニューを隠す" : "上級者メニュー（やり直し・お試し）"}
        </button>
        {showAdv && (
          <div className="mt-2 space-y-2">
            <p className="rounded-lg bg-[#fbf3df] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#8a6a25]">
              ⚠️ 既存のキャラ絵を上書きします。普段は使いません。
            </p>
            <button
              onClick={genOne}
              disabled={artBusy || !art?.configured}
              className="w-full rounded-full border border-moss bg-card py-2.5 text-[12.5px] font-bold text-moss-deep disabled:opacity-50"
            >
              🧪 まず1体お試し（先頭の銘柄で画風を確認）
            </button>
            <button
              onClick={genRebuild}
              disabled={artBusy || !art?.configured}
              className="w-full rounded-full border border-[#caa44c] bg-[#fbf3df] py-2.5 text-[12.5px] font-bold text-[#8a6a25] disabled:opacity-50"
            >
              🔄 全部モンスターで作り直す（既存を上書き）
            </button>
          </div>
        )}
        {rows.some((g) => g.has_art) && (
          <button
            onClick={() => setPreview(rows.find((g) => g.has_art) || null)}
            className="mt-2 w-full rounded-full border border-hairline bg-card py-2.5 text-[12.5px] font-bold text-moss-deep"
          >
            🎬 獲得演出（ご開帳）をプレビュー
          </button>
        )}
        {artErr && <p className="mt-2 rounded-xl bg-[#fbeceb] px-3 py-2 text-center text-[12px] text-[#b3261e]">{artErr}</p>}
      </div>

      {preview && (
        <SakegamiReveal
          name={preview.name}
          rarity={preview.rarity}
          artUrl={`/api/god-art/${preview.sake_id}?v=${String(preview.god_updated || "").replace(/\D/g, "").slice(0, 14) || "0"}`}
          extra={0}
          onClose={() => setPreview(null)}
        />
      )}

      <section className="mt-6">
        <h2 className="px-6 text-[11px] font-bold tracking-[0.14em] text-moss">生成済みの酒神（{rows.length}）</h2>
        <div className="mt-2 space-y-1.5 px-4">
          {rows.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-ink-soft">まだ生成されていません。上のボタンで作成してください。</p>}
          {rows.map((g) => (
            <div key={g.sake_id} className="flex items-start gap-3 rounded-xl bg-card px-4 py-2.5 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
              {g.has_art ? (
                <Image
                  src={`/api/god-art/${g.sake_id}?v=${String(g.god_updated || "").replace(/\D/g, "").slice(0, 14) || "0"}`}
                  alt=""
                  width={112}
                  height={112}
                  sizes="56px"
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  style={{ boxShadow: `0 0 0 1.5px ${(RARITY_META[g.rarity as Rarity] || RARITY_META.N).ring}` }}
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#f1efe9] text-[9px] text-ink-soft">絵なし</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge rarity={g.rarity} />
                  <span className="truncate text-[13px] font-bold">
                    {g.name || "（酒神名なし）"}
                    <span className="ml-1.5 font-normal text-ink-soft">{g.brand}{g.grade ? ` ${g.grade}` : ""}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-ink-soft">{g.region8 || "地方?"}</span>
                </div>
                {g.kuchijo && <p className="mt-1 text-[11px] leading-relaxed text-[#5a5e63]">{g.kuchijo}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
