"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type Sake, photoUrl, isFreshSensitive, missingInfo, bottleCups } from "@/lib/types";
import { resizeForAI, buildDisplayPhoto, type Bbox } from "@/lib/photo";

const CHART_AXES: { key: "sweet" | "acid" | "aroma" | "sharp"; label: string }[] = [
  { key: "sweet", label: "甘み" },
  { key: "acid", label: "酸味" },
  { key: "aroma", label: "香り" },
  { key: "sharp", label: "キレ" },
];
const splitTags = (v: string) => v.split(/[,、]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);

type Draft = {
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: string;
  season_label: string;
  description: string;
  taste_tags: string[];
  pairings: string[];
  taste_chart: { sweet: number; acid: number; aroma: number; sharp: number };
  is_hidden: boolean;
  label_color: string;
  delivered_at: string; // 'YYYY-MM-DD'（納品日・登録日）
  bottle_size: string; // '1.8L' | '720ml'
};

export function EditSake({ sake, cups }: { sake: Sake; cups?: { total: number; d30: number } }) {
  const router = useRouter();
  const photoRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>({
    brand: sake.brand,
    sub_name: sake.subName,
    brewery: sake.brewery,
    prefecture: sake.prefecture,
    grade: sake.grade,
    price: sake.price != null ? String(sake.price) : "",
    season_label: sake.seasonLabel,
    description: sake.description,
    taste_tags: sake.tasteTags,
    pairings: sake.pairings,
    taste_chart: sake.tasteChart,
    is_hidden: sake.isHidden,
    label_color: sake.labelColor,
    delivered_at: (sake.deliveredAt || "").slice(0, 10),
    bottle_size: sake.bottleSize || "1.8L",
  });
  const [stock, setStock] = useState<string>(sake.stockCount != null ? String(sake.stockCount) : "");
  // 鮮度枠の手動上書き（null=自動判定 / true=必ず出す / false=出さない）
  const [freshFlag, setFreshFlag] = useState<null | boolean>(
    sake.freshFlag == null ? null : !!sake.freshFlag
  );
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [godBusy, setGodBusy] = useState(false);
  const [godMsg, setGodMsg] = useState("");

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const bumpStock = (delta: number) => setStock((v) => String(Math.max(0, (Number(v) || 0) + delta)));
  // 「自動」を選んだ時に枠に出るかの目安（ラベルの語から判定・編集中の値で即更新）
  const autoFresh = isFreshSensitive({
    grade: draft.grade,
    subName: draft.sub_name,
    brand: draft.brand,
    tasteTags: draft.taste_tags,
  });

  // 銘柄・酒蔵・都道府県（人が確認した正しい情報）をもとに、AIが残りの項目を入れ直す。
  // brand/brewery/prefecture は上書きしない。確認のうえ「保存する」で確定。
  async function aiFill() {
    if (!draft.brand.trim()) {
      setError("先に銘柄を入れてください");
      return;
    }
    setAiBusy(true);
    setError("");
    setAiNote("");
    try {
      const r = await fetch("/api/admin/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: draft.brand,
          prefecture: draft.prefecture,
          brewery: draft.brewery,
          sub_name: draft.sub_name,
        }),
      });
      const j = (await r.json()) as Partial<{
        grade: string;
        sub_name: string;
        taste_tags: string[];
        taste_chart: { sweet: number; acid: number; aroma: number; sharp: number };
        description: string;
        label_color: string;
        error: string;
      }>;
      if (!r.ok) throw new Error(j.error || "AI補完に失敗しました");
      set({
        grade: j.grade || draft.grade,
        sub_name: j.sub_name || draft.sub_name || "",
        taste_tags: Array.isArray(j.taste_tags) && j.taste_tags.length ? j.taste_tags : draft.taste_tags,
        taste_chart: j.taste_chart || draft.taste_chart,
        description: j.description || draft.description,
        label_color: j.label_color || draft.label_color,
      });
      setAiNote("AIが情報を入れ直しました。内容を確認して「保存する」を押してください。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI補完に失敗しました");
    }
    setAiBusy(false);
  }

  // この酒だけ酒神キャラを生成/作り直し（他のキャラは一切変わらない）。新規追加の酒の導線。
  async function genGod() {
    setGodBusy(true);
    setGodMsg("");
    setError("");
    try {
      const r = await fetch("/api/admin/sakegami-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sakeId: sake.id }),
      });
      const j = await r.json();
      if (!r.ok) setError(j.message || j.error || "酒神の生成に失敗しました");
      else setGodMsg(`✓ 酒神「${j.name || "酒神"}」を生成しました（図鑑・詳細に反映）`);
    } catch {
      setError("酒神生成の通信に失敗しました");
    }
    setGodBusy(false);
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyPhoto(true);
    try {
      const bitmap = await createImageBitmap(file);
      const ai = resizeForAI(bitmap);
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
      const built = await buildDisplayPhoto(bitmap, bbox);
      setPhoto({ base64: built.base64, preview: built.preview });
    } catch {
      setError("写真の処理に失敗しました");
    }
    setBusyPhoto(false);
  }

  async function save() {
    // 必須5項目（銘柄・酒蔵・都道府県・特定名称・価格）。情報の無い銘柄を残さない（2026-08-14 オーナー指示）
    const missing = missingInfo({
      brand: draft.brand,
      brewery: draft.brewery,
      prefecture: draft.prefecture,
      grade: draft.grade,
      price: draft.price ? Number(draft.price) : null,
    });
    if (missing.length) {
      setError(`必須項目が未入力です：${missing.join("・")}（AI補完も使えます）`);
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/admin/sakes/${sake.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        details: {
          brand: draft.brand,
          sub_name: draft.sub_name,
          brewery: draft.brewery,
          prefecture: draft.prefecture,
          grade: draft.grade,
          price: draft.price ? Number(draft.price) : null,
          description: draft.description,
          taste_tags: draft.taste_tags,
          pairings: draft.pairings,
          taste_chart: draft.taste_chart,
          season_label: draft.season_label,
          is_hidden: draft.is_hidden,
          label_color: draft.label_color,
          delivered_at: draft.delivered_at,
          bottle_size: draft.bottle_size,
        },
        stock: stock.trim() === "" ? null : Number(stock),
        fresh: freshFlag,
        ...(photo ? { photo_base64: photo.base64, photo_type: "image/jpeg" } : {}),
      }),
    });
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error || "保存に失敗しました");
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg pb-16">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-xs text-ink-soft">
          ‹ 在庫ボードへ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">日本酒を編集</h1>
        <p className="mt-1 text-xs text-ink-soft">詳細・残数・写真を変更できます。</p>
      </header>

      <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />

      <div className="px-6 pt-3">
        {error && <p className="mb-2 text-xs text-[#b04a3a]">{error}</p>}

        {/* 写真（表示＋撮り直し） */}
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-[#f1efe9]">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.preview} alt="" className="h-full w-full object-cover" />
            ) : sake.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl(sake.id, sake.updatedAt)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xl text-[#c3c1ba]">🍶</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => photoRef.current?.click()}
              disabled={busyPhoto}
              className="rounded-full border border-moss bg-card px-3 py-1.5 text-[12px] font-bold text-moss-deep disabled:opacity-50"
            >
              {busyPhoto ? "処理中…" : sake.hasPhoto || photo ? "📷 写真を撮り直す" : "📷 写真を追加"}
            </button>
            <p className="mt-1.5 text-[11px] text-ink-soft">白背景に自動加工されます（中身はそのまま）。</p>
          </div>
        </div>

        {/* 残数 */}
        <div className="mb-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <p className="text-[11px] font-bold text-ink-soft">残数</p>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => bumpStock(-1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline text-lg">−</button>
            <input
              value={stock}
              onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="未管理"
              className="w-20 rounded-xl bg-paper px-3 py-2 text-center text-[15px] font-bold outline-none placeholder:text-[12px] placeholder:font-normal placeholder:text-[#c3c1ba]"
            />
            <button onClick={() => bumpStock(1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline text-lg">＋</button>
            <button onClick={() => setStock("")} className="ml-auto text-[11px] text-ink-soft underline">管理しない</button>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">空欄＝残数で管理しない（状態ボタンのみ）。<b className="text-moss-deep">0で自動的に売切</b>、補充（1以上）で売切から提供中に戻ります。</p>
          {cups && (
            <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-[11.5px] text-ink-soft">
              🍶 注文実績：<b className="text-moss-deep">直近30日 {cups.d30}杯・累計 {cups.total}杯</b>（90mlグラス）
            </p>
          )}
        </div>

        {/* 納品日と瓶の容量（消化日数・杯数の目安＝発注判断の土台データ） */}
        <div className="mb-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <p className="text-[11px] font-bold text-ink-soft">納品日（登録日）</p>
          <input
            type="date"
            value={draft.delivered_at}
            onChange={(e) => set({ delivered_at: e.target.value })}
            className="mt-2 w-full rounded-xl bg-paper px-3 py-2 text-[13.5px] font-semibold outline-none"
          />
          <p className="mt-1.5 text-[11px] text-ink-soft">この日から「何日で完売したか（消化日数）」を数えます。再納品したら日付を入れ直してください。</p>
          <p className="mt-3 text-[11px] font-bold text-ink-soft">瓶の容量</p>
          <div className="mt-2 flex gap-2">
            {(["1.8L", "720ml"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set({ bottle_size: v })}
                className={`flex-1 rounded-full border px-2 py-2 text-[12.5px] font-bold ${
                  draft.bottle_size === v ? "border-moss-deep bg-moss-deep text-white" : "border-hairline bg-paper text-ink-soft"
                }`}
              >
                {v}（約{bottleCups(v)}杯）
              </button>
            ))}
            {!["1.8L", "720ml"].includes(draft.bottle_size) && (
              <span className="flex items-center rounded-full border border-hairline px-3 text-[11.5px] text-ink-soft">現在: {draft.bottle_size}</span>
            )}
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-soft">提供90mlグラス換算の目安（1.8L=約20杯・720ml=約8杯）。</p>
        </div>

        {/* 開けたて・お早めに枠（鮮度） */}
        <div className="mb-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <p className="text-[11px] font-bold text-ink-soft">🧊 開けたて・お早めに枠</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            生酒・にごり・無濾過生など<b className="text-moss-deep">開栓後に早めに飲みたい酒</b>を、お客様トップとAI相談で優先的におすすめします。
            ふだんは<b>自動</b>のままでOK（ラベルの語から判定）。判定が外れている時だけ手動で指定してください。
          </p>
          <div className="mt-2.5 flex gap-2">
            {([
              { v: null, label: `自動（今: ${autoFresh ? "対象" : "対象外"}）` },
              { v: true, label: "必ず出す" },
              { v: false, label: "出さない" },
            ] as { v: null | boolean; label: string }[]).map((o) => {
              const active = freshFlag === o.v;
              return (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setFreshFlag(o.v)}
                  className={`flex-1 rounded-full border px-2 py-2 text-[12px] font-bold ${
                    active ? "border-[#2f7d8c] bg-[#2f7d8c] text-white" : "border-hairline bg-paper text-ink-soft"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 基本項目 */}
        <div className="space-y-px overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <Field label="銘柄 ＊" value={draft.brand} onChange={(v) => set({ brand: v })} />
          <Field label="補足" value={draft.sub_name} onChange={(v) => set({ sub_name: v })} placeholder="例: 山田錦 無濾過生原酒" />
          <Field label="酒蔵 ＊" value={draft.brewery} onChange={(v) => set({ brewery: v })} placeholder="必須" />
          <Field label="都道府県 ＊" value={draft.prefecture} onChange={(v) => set({ prefecture: v })} placeholder="必須" />
          <Field label="特定名称 ＊" value={draft.grade} onChange={(v) => set({ grade: v })} placeholder="必須" />
          <Field label="価格 (円) ＊" value={draft.price} onChange={(v) => set({ price: v.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="必須" />
          <Field label="季節ラベル" value={draft.season_label} onChange={(v) => set({ season_label: v })} placeholder="例: 夏限定" />
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] text-ink-soft">＊は必須（銘柄・酒蔵・都道府県・特定名称・価格）。空のままだと保存できません。</p>

        {/* AIで情報を入れ直す（ラベル誤認識の修正用） */}
        <div className="mt-3 rounded-2xl border border-moss/30 bg-[#eef3ef] p-4">
          <p className="text-[12.5px] font-bold text-moss-deep">🤖 AIで情報を入れ直す</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            上の<b className="text-moss-deep">銘柄・酒蔵・都道府県</b>を正しく入れてからこのボタンを押すと、
            <b>特定名称・補足・味わいタグ・味わいチャート・紹介文・色</b>をAIが調べ直して入れ替えます（相性料理・価格・残数は変えません）。
            <br />
            すぐには保存されません。内容を確認してから「保存する」を押してください。
          </p>
          <button
            onClick={aiFill}
            disabled={aiBusy}
            className="mt-3 w-full rounded-full bg-moss py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
          >
            {aiBusy ? "AIが調べています…（10〜30秒）" : "🤖 銘柄・酒蔵・県からAIで入れ直す"}
          </button>
          {aiNote && <p className="mt-2 text-[11px] font-bold text-moss-deep">{aiNote}</p>}
        </div>

        {/* この酒の酒神キャラを生成（新規追加の酒の導線・他のキャラは変わらない） */}
        <div className="mt-3 rounded-2xl border border-[#caa44c]/40 bg-[#fbf6ea] p-4">
          <p className="text-[12.5px] font-bold text-[#8a6a25]">🐉 この酒の酒神キャラを生成</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            この日本酒1本ぶんだけ酒神（モンスター）を作ります。<b>他のキャラは一切変わりません</b>。
            写真があるとラベルの世界観で生成されます（無くても銘柄名から生成）。作り直したい時にも使えます。
          </p>
          <button
            onClick={genGod}
            disabled={godBusy}
            className="mt-3 w-full rounded-full bg-[#8a6a25] py-3 text-[13.5px] font-bold text-white disabled:opacity-50"
          >
            {godBusy ? "酒神を生成中…（20〜40秒）" : "🐉 この酒の酒神を生成する"}
          </button>
          {godMsg && <p className="mt-2 text-[11px] font-bold text-[#8a6a25]">{godMsg}</p>}
        </div>

        {/* 紹介文・タグ */}
        <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <p className="text-[11px] font-bold text-ink-soft">紹介文</p>
          <textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={4}
            className="mt-2 w-full resize-none rounded-xl bg-paper px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
          <label className="mt-3 block text-[11px] font-bold text-ink-soft">
            味わいタグ（カンマ区切り）
            <input
              value={draft.taste_tags.join("、")}
              onChange={(e) => set({ taste_tags: splitTags(e.target.value) })}
              placeholder="例: フルーティ、華やか"
              className="mt-1 w-full rounded-xl bg-paper px-3 py-2 text-[13px] font-normal outline-none placeholder:text-[#c3c1ba]"
            />
          </label>
          <label className="mt-2 block text-[11px] font-bold text-ink-soft">
            相性の良い料理（カンマ区切り）
            <input
              value={draft.pairings.join("、")}
              onChange={(e) => set({ pairings: splitTags(e.target.value) })}
              placeholder="例: 刺身、塩焼き"
              className="mt-1 w-full rounded-xl bg-paper px-3 py-2 text-[13px] font-normal outline-none placeholder:text-[#c3c1ba]"
            />
          </label>
        </div>

        {/* 味わいチャート */}
        <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <p className="text-[11px] font-bold text-ink-soft">味わいチャート（1〜5）</p>
          <div className="mt-2 space-y-2.5">
            {CHART_AXES.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-[12px] text-ink-soft">{label}</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={draft.taste_chart[key]}
                  onChange={(e) => set({ taste_chart: { ...draft.taste_chart, [key]: Number(e.target.value) } })}
                  className="h-1.5 flex-1 accent-[#1e3d2f]"
                />
                <span className="w-4 text-right text-[12px] font-bold text-moss-deep">{draft.taste_chart[key]}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="mt-3 flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
          <input type="checkbox" checked={draft.is_hidden} onChange={(e) => set({ is_hidden: e.target.checked })} className="h-5 w-5 accent-[#1e3d2f]" />
          <span className="text-sm">隠し酒にする（お客様の一覧には表示しません・特別提供/引換用）</span>
        </label>

        <div className="mt-5 flex gap-3">
          <Link href="/admin" className="rounded-full border border-hairline bg-card px-5 py-4 text-sm text-ink-soft">
            やめる
          </Link>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white shadow-[0_10px_26px_rgba(30,61,47,0.35)] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <label className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
      <span className="w-20 shrink-0 text-[11px] text-ink-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full bg-transparent text-[13.5px] font-semibold outline-none placeholder:font-normal placeholder:text-[#c3c1ba]"
      />
    </label>
  );
}
