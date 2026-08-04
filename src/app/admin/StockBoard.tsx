"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Sake } from "@/lib/types";
import { digestDays, photoUrl } from "@/lib/types";
import { resizeForAI, buildDisplayPhoto, reprocessToGodBg, type Bbox } from "@/lib/photo";
import { rarityFor } from "@/lib/sakegami";
import { PasswordChange } from "./PasswordChange";

// Sake → 酒神レア度（写真背景の色分けに使う・rarityForと同じ判定）
function rarityOf(s: Sake): string {
  return rarityFor({ price: s.price, grade: s.grade, seasonLabel: s.seasonLabel, isHidden: s.isHidden, brand: s.brand });
}

const STATUS_LABELS: { value: Sake["status"]; label: string; activeClass: string }[] = [
  { value: "available", label: "提供中", activeClass: "bg-moss text-white" },
  { value: "soldout", label: "売切", activeClass: "bg-[#80868c] text-white" },
];

export function StockBoard({ initialSakes, owner = false }: { initialSakes: Sake[]; owner?: boolean }) {
  const [sakes, setSakes] = useState(initialSakes);
  const dragId = useRef<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  // AI仕入れ提案
  const [showSoldout, setShowSoldout] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insight, setInsight] = useState<{ summary: string; suggestions: { title: string; detail: string }[] } | null>(null);
  const [insightNote, setInsightNote] = useState("");

  async function runInsights() {
    setInsightLoading(true);
    setInsight(null);
    setInsightNote("");
    try {
      const res = await fetch("/api/admin/insights", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setInsightNote(j?.error === "ai_unconfigured" ? "AI未設定です" : "分析に失敗しました");
      } else {
        setInsight(j.insight);
        if (!j.hasData) setInsightNote(`まだ注文・AI相談のデータが少ないです（注文${j.counts?.orders ?? 0}件・AI相談${j.counts?.aiQueries ?? 0}件）。使われるほど精度が上がります。`);
      }
    } catch {
      setInsightNote("通信に失敗しました");
    }
    setInsightLoading(false);
  }
  // 写真の撮り直し（白背景に差し替え）
  const photoRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<number | null>(null);
  const [busyPhoto, setBusyPhoto] = useState<number | null>(null);
  const [newPhoto, setNewPhoto] = useState<Record<number, string>>({});

  function pickPhoto(id: number) {
    photoTarget.current = id;
    photoRef.current?.click();
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = photoTarget.current;
    e.target.value = ""; // 同じ写真でも選び直せるように
    if (!file || id == null) return;
    setBusyPhoto(id);
    try {
      const bitmap = await createImageBitmap(file);
      const ai = resizeForAI(bitmap);
      // 瓶の位置（bbox）だけAIに取得（項目は上書きしない）
      let bbox: Bbox = { x: 0, y: 0, w: 1, h: 1 };
      try {
        const r = await fetch("/api/admin/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: ai.base64, media_type: "image/jpeg" }),
        });
        if (r.ok) {
          const j = (await r.json()) as { bbox?: Bbox };
          if (j.bbox) bbox = j.bbox;
        }
      } catch {}
      const tgt = sakes.find((x) => x.id === id);
      const built = await buildDisplayPhoto(bitmap, bbox, tgt ? rarityOf(tgt) : "R");
      const res = await fetch(`/api/admin/sakes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_base64: built.base64, photo_type: "image/jpeg" }),
      });
      if (res.ok) setNewPhoto((m) => ({ ...m, [id]: built.preview }));
    } catch {
      // 失敗時は何もしない（元写真のまま）
    }
    setBusyPhoto(null);
  }

  // 既存写真を一括で「酒神カラー背景」に再加工（ブラウザで1枚ずつ・白を切り抜いて置き直す）
  const [reBusy, setReBusy] = useState(false);
  const [reMsg, setReMsg] = useState("");
  async function reprocessAll() {
    const targets = sakes.filter((s) => s.hasPhoto);
    if (!targets.length) { setReMsg("写真のある銘柄がありません"); return; }
    if (!confirm(`${targets.length}件の写真を「酒神カラー背景」に再加工します。\nブラウザで1枚ずつ処理するため数分かかります。この画面を開いたままお待ちください。`)) return;
    setReBusy(true);
    let done = 0, failed = 0;
    for (const s of targets) {
      setReMsg(`再加工中… ${done + failed + 1}/${targets.length}`);
      try {
        const resp = await fetch(photoUrl(s.id, s.updatedAt));
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const out = await reprocessToGodBg(bmp, rarityOf(s));
        if (!out) { failed++; continue; }
        const pr = await fetch(`/api/admin/sakes/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photo_base64: out.base64, photo_type: "image/jpeg" }),
        });
        if (pr.ok) { done++; setNewPhoto((m) => ({ ...m, [s.id]: `data:image/jpeg;base64,${out.base64}` })); }
        else failed++;
      } catch { failed++; }
    }
    setReMsg(`✓ 再加工 完了：${done}件${failed ? ` ・ 失敗 ${failed}件（時間をおいて再実行で続けられます）` : ""}`);
    setReBusy(false);
  }

  // 自動売切の全解除（2026-07-24 オーナー指示）: 残数を全て「管理しない」へ＋現在の売切を一括で提供中に戻す。
  // 以後の売切/提供中はこのボードの手動切替のみ（注文で勝手に売切にならない）。
  const [fixBusy, setFixBusy] = useState(false);
  async function disableAutoSoldout() {
    if (!confirm("自動売切を全解除します。\n・全銘柄の残数を「管理しない」に戻す\n・現在売切の銘柄をすべて「提供中」に戻す\n\n本当に切れている銘柄は、実行後に手動で「売切」にしてください。\n（残数管理は、その後も銘柄ごとに＋で改めて始められます）よろしいですか？")) return;
    setFixBusy(true);
    try {
      const res = await fetch("/api/admin/sakes/disable-auto-soldout", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        setReMsg(`✓ 自動売切を解除しました：売切→提供中 ${j.restored}件・残数解除 ${j.cleared}件。ページを再読み込みします`);
        setTimeout(() => location.reload(), 1200);
      } else {
        setReMsg(`解除に失敗しました（${j?.error || res.status}）`);
      }
    } catch {
      setReMsg("解除に失敗しました（通信エラー）");
    }
    setFixBusy(false);
  }

  async function syncSmaregi() {
    if (!confirm("登録中の日本酒をすべてスマレジに商品登録します。\n（既に登録済みのものはスキップ）")) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch("/api/admin/smaregi-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "missing" }),
      });
      const j = await res.json();
      if (!res.ok) {
        setSyncMsg(j?.error === "smaregi_unconfigured" ? "スマレジ未設定です" : "同期に失敗しました");
      } else {
        const f = (j.failed || []).length;
        setSyncMsg(`✓ 新規${j.created}件・スキップ${j.skipped}件${f ? `・失敗${f}件` : ""}（計${j.total}件）`);
      }
    } catch {
      setSyncMsg("通信に失敗しました");
    } finally {
      setSyncing(false);
    }
  }

  // この画面で売切にした銘柄（2026-07-29 オーナー指示）。
  // 売切にした瞬間に一覧から消えると「今なにを売切にしたか」が分からなくなるため、
  // 開いている間はグレーで残す。画面を離れて入り直すと（この state が消えるので）一覧から下がる。
  const [justSoldout, setJustSoldout] = useState<Set<number>>(new Set());

  async function setStatus(id: number, status: Sake["status"]) {
    const prev = sakes;
    setJustSoldout((set) => {
      const n = new Set(set);
      if (status === "soldout") n.add(id);
      else n.delete(id); // 提供中に戻したら通常表示へ
      return n;
    });
    setSakes((list) => list.map((s) => (s.id === id ? { ...s, status } : s)));
    const res = await fetch(`/api/admin/sakes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) setSakes(prev); // 失敗時は戻す
  }

  // 残数は「±で数を決める → 保存で確定」（2026-07-29 オーナー指示）。
  // ±を押すたびに即保存していたため、誤タップがそのまま在庫に入り、気づかないうちに残数が狂っていた。
  // draft に貯めて、保存のときに銘柄名と最終的な数を出して1回だけ確認する。
  const [stockDraft, setStockDraft] = useState<Record<number, number>>({});
  const [stockBusy, setStockBusy] = useState<number | null>(null);
  const draftOf = (s: Sake) => (s.id in stockDraft ? stockDraft[s.id] : s.stockCount);
  const isDirty = (s: Sake) => s.id in stockDraft && stockDraft[s.id] !== s.stockCount;
  function bumpDraft(s: Sake, delta: number) {
    const base = draftOf(s) ?? 0;
    setStockDraft((d) => ({ ...d, [s.id]: Math.max(0, base + delta) }));
  }
  function cancelDraft(id: number) {
    setStockDraft((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  }
  async function saveStock(s: Sake) {
    const next = stockDraft[s.id];
    if (next == null || next === s.stockCount || stockBusy) return;
    // 管理開始（—→数値）は「これから自動売切の対象になる」と明記して確認（2026-07-24の“勝手に売切”対策）
    const head =
      s.stockCount == null
        ? `「${s.brand}」の残数管理を始めます。\n残数を ${next} にしてよろしいですか？\n（注文ごとに減り、0で自動的に売切になります）`
        : `「${s.brand}」の残数を ${s.stockCount} → ${next} に変更します。よろしいですか？`;
    const tail = next === 0 ? "\n\n※0にすると売切になります。" : "";
    if (!confirm(head + tail)) return;
    setStockBusy(s.id);
    await setStock(s.id, next);
    cancelDraft(s.id);
    setStockBusy(null);
  }

  // 残数の保存（0で自動売切、1以上で提供中に戻す。next=null で管理しない）
  async function setStock(id: number, next: number | null) {
    const prev = sakes;
    setSakes((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        const status: Sake["status"] = next === 0 ? "soldout" : next != null && s.status === "soldout" ? "available" : s.status;
        return { ...s, stockCount: next, status };
      })
    );
    const res = await fetch(`/api/admin/sakes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: next }),
    });
    if (!res.ok) setSakes(prev); // 失敗時は戻す
  }

  // 初心者おすすめ（客の一覧トップ「今日の3本」に出す）
  async function setBeginner(id: number, next: boolean) {
    const prev = sakes;
    setSakes((list) => list.map((s) => (s.id === id ? { ...s, isBeginner: next } : s)));
    const res = await fetch(`/api/admin/sakes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beginner: next }),
    });
    if (!res.ok) setSakes(prev); // 失敗時は戻す
  }

  async function removeSake(id: number, brand: string) {
    if (!confirm(`「${brand}」を消去しますか？\n客向け一覧・図鑑から消えます（「🗂 在庫から外した酒」から復元できます）。`)) return;
    const prev = sakes;
    setSakes((list) => list.filter((s) => s.id !== id)); // 楽観的に消す
    const res = await fetch(`/api/admin/sakes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) setSakes(prev); // 失敗時は戻す
  }

  function onDrop(targetId: number) {
    const fromId = dragId.current;
    dragId.current = null;
    if (fromId == null || fromId === targetId) return;
    const list = [...sakes];
    const fromIdx = list.findIndex((s) => s.id === fromId);
    const toIdx = list.findIndex((s) => s.id === targetId);
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    setSakes(list);
    fetch("/api/admin/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: list.map((s) => s.id) }),
    });
  }

  return (
    <main className="mx-auto max-w-lg pb-32">
      <header className="px-6 pt-12 pb-2">
        <p className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">STAFF</p>
        <h1 className="mt-1 text-2xl font-bold">在庫ボード</h1>
        <p className="mt-1 text-xs text-ink-soft">タップで切替・つかんで並べ替え</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link href="/admin/invoice" className="rounded-full border border-moss bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🧾 納品書スキャン
          </Link>
          <Link href="/admin/settings" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            ⚙️ 価格設定
          </Link>
          <Link href="/admin/archive" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🗂 在庫から外した酒
          </Link>
          <Link href="/admin/smaregi" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🧾 スマレジ連携
          </Link>
          <Link href="/admin/rewards" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🍶 隠し酒引換
          </Link>
          <Link href="/admin/sakegami" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🐉 酒神メタ生成
          </Link>
          <Link href="/admin/mascot" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
            🌱 すぎだまる生成
          </Link>
          <PasswordChange />
          {owner && (
            <Link href="/admin/staff" className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep">
              👥 スタッフ管理
            </Link>
          )}
          <button
            onClick={reprocessAll}
            disabled={reBusy}
            className="rounded-full border border-moss bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep disabled:opacity-50"
          >
            {reBusy ? "再加工中…" : "🎨 写真を酒神背景に一括再加工"}
          </button>
          {owner && (
            <button
              onClick={disableAutoSoldout}
              disabled={fixBusy}
              className="rounded-full border border-[#b3261e] bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-[#b3261e] disabled:opacity-50"
              title="残数を全て「管理しない」へ戻し、現在売切の銘柄を一括で提供中に戻します（以後の売切は手動のみ）"
            >
              {fixBusy ? "解除中…" : "🔓 自動売切を全解除（売切→提供中）"}
            </button>
          )}
        </div>
        {reMsg && <p className="mt-2 rounded-xl bg-[#eef3ef] px-4 py-2 text-center text-[12px] font-bold text-moss-deep">{reMsg}</p>}
      </header>

      <p className="mx-6 my-3 rounded-xl bg-[#eef3ef] px-4 py-2.5 text-[11.5px] text-ink-soft">
        💡 普段は<b className="text-moss-deep">触らなくてOK</b>。売り切れた時だけ「売切」を1タップ。
        左の<b className="text-moss-deep">📷</b>で写真を酒神カラー背景に撮り直せます（中身はそのまま）。
        <br />
        <b className="text-[#caa23f]">☆</b> を押すと客アプリのトップに「<b className="text-moss-deep">日本酒がはじめての方へ・今日の3本</b>」として表示されます（おすすめ {sakes.filter((s) => s.isBeginner).length}/3）。
      </p>

      <div className="mx-6 mb-3 flex items-center gap-3">
        <button
          onClick={syncSmaregi}
          disabled={syncing}
          className="rounded-full border border-moss px-3.5 py-2 text-[11.5px] font-bold text-moss disabled:opacity-50"
        >
          {syncing ? "同期中…" : "スマレジに全件同期"}
        </button>
        {syncMsg && <span className="text-[11px] text-ink-soft">{syncMsg}</span>}
      </div>

      {/* AI仕入れ提案（注文実績＋お客様のAI相談から分析） */}
      <div className="mx-6 mb-4 rounded-2xl border border-hairline bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-moss-deep">📊 AI仕入れ提案</p>
            <p className="mt-0.5 text-[11px] text-ink-soft">注文実績とお客様のAI相談から「次に仕入れるべき日本酒」を分析します。</p>
          </div>
          <button
            onClick={runInsights}
            disabled={insightLoading}
            className="shrink-0 rounded-full bg-moss-deep px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50"
          >
            {insightLoading ? "分析中…" : "分析する"}
          </button>
        </div>
        {insightNote && <p className="mt-3 rounded-xl bg-[#eef3ef] px-3 py-2 text-[11.5px] text-ink-soft">{insightNote}</p>}
        {insight && (
          <div className="mt-3">
            {insight.summary && <p className="text-[13px] font-bold text-moss-deep">{insight.summary}</p>}
            <div className="mt-2 space-y-2">
              {insight.suggestions.map((s, i) => (
                <div key={i} className="rounded-xl bg-paper px-3.5 py-2.5">
                  <p className="text-[12.5px] font-bold">💡 {s.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#3c3f44]">{s.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhotoFile} />

      {sakes.some((s) => s.status === "soldout") && (
        <div className="mx-6 mb-2">
          <button onClick={() => setShowSoldout((v) => !v)} className="text-[11.5px] text-ink-soft underline">
            {showSoldout ? "売切れを隠す" : `売切れも表示（${sakes.filter((s) => s.status === "soldout").length}）`}
          </button>
        </div>
      )}

      <div className="space-y-2.5 px-4">
        {/* 売切は通常は隠すが、この画面で売切にしたものだけは残す（何を切ったか見失わないため・2026-07-29）。
            残すのは開いている間だけ。入り直すと justSoldout が空になり、通常どおり一覧から下がる。 */}
        {(showSoldout ? sakes : sakes.filter((s) => s.status !== "soldout" || justSoldout.has(s.id))).map((s) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => (dragId.current = s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(s.id)}
            className={`flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-[0_1px_3px_rgba(38,40,43,0.05)] ${
              s.status === "soldout" ? "opacity-55" : ""
            }`}
          >
            <span className="cursor-grab text-base tracking-[-2px] text-[#c9c7c1]">⠿</span>
            <button
              onClick={() => pickPhoto(s.id)}
              disabled={busyPhoto === s.id}
              className="relative h-11 w-9 shrink-0 overflow-hidden rounded-md bg-[#f1efe9]"
              title="写真を撮り直す（白背景に統一）"
            >
              {newPhoto[s.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={newPhoto[s.id]} alt="" className="h-full w-full object-cover" />
              ) : s.hasPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl(s.id, s.updatedAt)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="block h-full w-full" style={{ background: s.labelColor }} />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[8px] leading-none text-white">
                {busyPhoto === s.id ? "…" : "📷"}
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">
                {s.brand}
                {s.grade && <span className="ml-1 font-normal text-ink-soft">{s.grade}</span>}
                {s.isHidden && <span className="ml-1 text-[10px] text-moss-deep">（隠し酒）</span>}
                {/* この画面で売切にしたもの＝一時的に残しているだけ、と分かるようにする */}
                {justSoldout.has(s.id) && !showSoldout && (
                  <span className="ml-1.5 rounded bg-[#80868c] px-1.5 py-0.5 align-middle text-[9.5px] font-bold text-white">売切にしました</span>
                )}
              </p>
              <p className="text-[11px] text-ink-soft">{s.price != null ? `¥${s.price.toLocaleString()}` : "—"}</p>
              {s.status === "soldout" && digestDays(s.deliveredAt, s.soldoutAt) != null && (
                <p className="mt-0.5 text-[10.5px] font-bold text-moss-deep">
                  🍶 {digestDays(s.deliveredAt, s.soldoutAt) === 0 ? "当日完売" : `${digestDays(s.deliveredAt, s.soldoutAt)}日で完売`}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {/* 提供中／売切 */}
              <div className="flex gap-0.5 rounded-full bg-[#eeede9] p-[3px]">
                {STATUS_LABELS.map(({ value, label, activeClass }) => (
                  <button
                    key={value}
                    onClick={() => setStatus(s.id, value)}
                    className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                      s.status === value ? activeClass : "text-ink-soft"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* 残数（±で決めてから保存で確定。誤タップがそのまま在庫に入らないように・2026-07-29） */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-soft">残</span>
                <button
                  onClick={() => draftOf(s) != null && bumpDraft(s, -1)}
                  aria-label="残数を1減らす"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline text-[15px] leading-none text-ink-soft active:scale-90"
                >
                  −
                </button>
                <span
                  className={`min-w-[1.6ch] text-center text-[13px] font-bold tabular-nums ${isDirty(s) ? "text-[#b45309]" : "text-moss-deep"}`}
                >
                  {draftOf(s) != null ? draftOf(s) : "—"}
                </span>
                <button
                  onClick={() => bumpDraft(s, 1)}
                  aria-label="残数を1増やす"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline text-[15px] leading-none text-ink-soft active:scale-90"
                >
                  ＋
                </button>
                {/* 変更中だけ出る。押すまでは在庫に反映されない＝押し間違えても「やめる」で消せる */}
                {isDirty(s) && (
                  <>
                    <button
                      onClick={() => void saveStock(s)}
                      disabled={stockBusy === s.id}
                      className="ml-0.5 rounded-full bg-moss-deep px-2.5 py-1 text-[11px] font-bold text-white active:scale-95 disabled:opacity-50"
                    >
                      {stockBusy === s.id ? "保存中…" : "保存"}
                    </button>
                    <button
                      onClick={() => cancelDraft(s.id)}
                      className="rounded-full border border-hairline px-2 py-1 text-[11px] font-bold text-ink-soft active:scale-95"
                    >
                      やめる
                    </button>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => setBeginner(s.id, !s.isBeginner)}
              aria-label={s.isBeginner ? `${s.brand}の初心者おすすめを外す` : `${s.brand}を初心者おすすめにする`}
              title="初心者おすすめ（今日の3本）"
              className={`shrink-0 px-1 text-base leading-none transition-colors ${s.isBeginner ? "text-[#caa23f]" : "text-[#c9c7c1] hover:text-[#caa23f]"}`}
            >
              {s.isBeginner ? "★" : "☆"}
            </button>
            <Link
              href={`/admin/sake/${s.id}/edit`}
              aria-label={`${s.brand}を編集`}
              title="詳細・残数を編集"
              className="shrink-0 px-1 text-base text-[#9a988f] transition-colors hover:text-moss-deep"
            >
              ✎
            </Link>
            <button
              onClick={() => removeSake(s.id, s.brand)}
              aria-label={`${s.brand}を削除`}
              className="shrink-0 px-1 text-lg text-[#c9c7c1] transition-colors hover:text-[#b04a3a]"
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      {sakes.length === 0 && (
        <p className="px-6 py-14 text-center text-sm text-ink-soft">
          まだ日本酒がありません。右下の📷から最初の一本を登録してください。
        </p>
      )}

      <Link
        href="/admin/new"
        className="fixed bottom-7 right-5 flex h-16 w-16 items-center justify-center rounded-full bg-moss-deep text-2xl shadow-[0_12px_28px_rgba(30,61,47,0.45)]"
        aria-label="新しい日本酒を登録"
      >
        📷
      </Link>
    </main>
  );
}
