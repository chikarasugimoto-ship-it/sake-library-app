"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resizeForAI, buildDisplayPhoto, type Bbox } from "@/lib/photo";
import { missingInfo } from "@/lib/types";

type Draft = {
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: string;
  description: string;
  taste_tags: string[];
  pairings: string[];
  taste_chart: { sweet: number; acid: number; aroma: number; sharp: number };
  season_label: string;
  is_hidden: boolean;
  label_color: string;
  bottle_size: string; // '1.8L' | '720ml'（既定は1.8L）
  confidence: number;
};

const EMPTY: Draft = {
  brand: "",
  sub_name: "",
  brewery: "",
  prefecture: "",
  grade: "",
  price: "",
  description: "",
  taste_tags: [],
  pairings: [],
  taste_chart: { sweet: 3, acid: 3, aroma: 3, sharp: 3 },
  season_label: "",
  is_hidden: false,
  label_color: "#1e3d2f",
  bottle_size: "1.8L",
  confidence: 0,
};

const CHART_AXES: { key: keyof Draft["taste_chart"]; label: string }[] = [
  { key: "sweet", label: "甘み" },
  { key: "acid", label: "酸味" },
  { key: "aroma", label: "香り" },
  { key: "sharp", label: "キレ" },
];

// カンマ・読点区切りの文字列 ⇄ 配列（最大5件）
const splitTags = (v: string) =>
  v
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

export default function NewSake() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "recognizing" | "confirm" | "saving">("idle");
  const [manual, setManual] = useState(false); // 手入力モード（写真は任意）
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("AIがラベルを読んでいます…");

  // 写真からAIで読み取り→項目を自動入力（撮影登録）
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setManual(false);
    setError("");
    setStatusMsg("AIがラベルを読んでいます…");
    setPhase("recognizing");
    try {
      const bitmap = await createImageBitmap(file);
      const ai = resizeForAI(bitmap);
      setPhoto(ai); // 認識中は元写真をプレビュー
      const res = await fetch("/api/admin/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: ai.base64, media_type: "image/jpeg" }),
      });
      let bbox: Bbox = { x: 0, y: 0, w: 1, h: 1 };
      if (res.ok) {
        const r = (await res.json()) as Omit<Draft, "price" | "season_label" | "is_hidden"> & {
          confidence: number;
          bbox?: Bbox;
        };
        if (r.bbox) bbox = r.bbox;
        setDraft({ ...EMPTY, ...r, price: "", taste_tags: r.taste_tags ?? [], pairings: r.pairings ?? [] });
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError((j.error || "AI認識に失敗しました") + " — 内容を手で確認してください");
        setDraft(EMPTY);
      }
      setStatusMsg("背景を整えています…（初回は少し時間がかかります）");
      try {
        const built = await buildDisplayPhoto(bitmap, bbox);
        setPhoto({ base64: built.base64, preview: built.preview });
      } catch {
        // 補正に失敗しても元写真(ai)のまま継続
      }
    } catch {
      setError("写真の処理に失敗しました");
      setDraft(EMPTY);
    }
    setPhase("confirm");
  }

  // 手入力フォームに写真を“あとから”添付（項目は上書きしない・白背景に整える）
  async function onAttachPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
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
    setPhotoBusy(false);
  }

  function startManual() {
    setManual(true);
    setDraft(EMPTY);
    setPhoto(null);
    setError("");
    setPhase("confirm");
  }

  function reset() {
    setPhase("idle");
    setManual(false);
    setPhoto(null);
    setDraft(EMPTY);
    setError("");
  }

  async function save() {
    // 必須5項目（銘柄・酒蔵・都道府県・特定名称・価格）。情報の無い銘柄を作らない（2026-08-14 オーナー指示）
    const missing = missingInfo({
      brand: draft.brand,
      brewery: draft.brewery,
      prefecture: draft.prefecture,
      grade: draft.grade,
      price: draft.price ? Number(draft.price) : null,
    });
    if (missing.length) {
      setError(`必須項目が未入力です：${missing.join("・")}`);
      return;
    }
    setPhase("saving");
    const res = await fetch("/api/admin/sakes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        price: draft.price ? Number(draft.price) : null,
        photo_base64: photo?.base64,
        photo_type: photo ? "image/jpeg" : undefined,
      }),
    });
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error || "登録に失敗しました");
      setPhase("confirm");
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <main className="mx-auto max-w-lg pb-16">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-xs text-ink-soft">
          ‹ 在庫ボードへ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{manual ? "手入力で登録" : "新しい日本酒を登録"}</h1>
        <p className="mt-1 text-xs text-ink-soft">
          {manual ? "わかる項目だけでOK。写真はあとから付けられます。" : "ラベルを撮るだけ。あとはAIが書きます。"}
        </p>
      </header>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onPick} />
      <input ref={attachRef} type="file" accept="image/*" hidden onChange={onAttachPhoto} />

      {phase === "idle" && (
        <div className="px-6">
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-3xl bg-gradient-to-br from-[#23262a] to-[#101214] text-white"
          >
            <span className="text-4xl">📷</span>
            <span className="text-sm font-semibold">ラベルを撮影する</span>
            <span className="text-[11px] text-white/50">ラベル全体が入るように</span>
          </button>
          <button
            onClick={() => galleryRef.current?.click()}
            className="mt-3 w-full rounded-full border border-hairline bg-card py-3.5 text-sm font-semibold text-ink-soft"
          >
            🖼 写真を選ぶ（カメラロール）
          </button>
          <button
            onClick={startManual}
            className="mt-3 w-full rounded-full border border-moss bg-card py-3.5 text-sm font-bold text-moss-deep"
          >
            ✍️ 手入力で登録する（写真なしでもOK）
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-soft">
            お店にいないときは、保存した日本酒の写真でも試せます
          </p>
          <a
            href="/admin/menu-scan"
            className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-moss bg-card py-3.5 text-sm font-bold text-moss"
          >
            🗒 品書きを撮って「まとめて登録」
          </a>
        </div>
      )}

      {phase === "recognizing" && (
        <div className="mx-6 mt-4 flex aspect-[4/5] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl bg-[#101214]">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.preview} alt="" className="h-40 rounded-xl object-cover opacity-80" />
          )}
          <p className="animate-pulse text-sm text-white/80">{statusMsg}</p>
        </div>
      )}

      {(phase === "confirm" || phase === "saving") && (
        <div className="px-6 pt-3">
          {draft.confidence > 0 && (
            <p className="inline-flex items-center gap-2 rounded-full bg-[#eef3ef] px-3 py-1.5 text-[11px] font-bold text-moss-deep">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-moss" />
              AIがラベルを認識しました（確信度 {Math.round(draft.confidence * 100)}%）
            </p>
          )}
          {error && <p className="mt-2 text-xs text-[#b04a3a]">{error}</p>}

          {/* 写真（任意・手入力でもあとから付けられる） */}
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
            <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-[#f1efe9]">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xl text-[#c3c1ba]">🍶</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => attachRef.current?.click()}
                  disabled={photoBusy}
                  className="rounded-full border border-moss bg-card px-3 py-1.5 text-[12px] font-bold text-moss-deep disabled:opacity-50"
                >
                  {photoBusy ? "処理中…" : photo ? "📷 写真を変更" : "📷 写真を追加"}
                </button>
                {photo && (
                  <button
                    onClick={() => setPhoto(null)}
                    className="rounded-full border border-hairline px-3 py-1.5 text-[12px] text-ink-soft"
                  >
                    削除
                  </button>
                )}
              </div>
              {!photo && (
                <p className="mt-1.5 text-[11px] leading-snug text-[#b04a3a]">
                  写真がないと、お客様の一覧には表示されません（データのみ保存）。
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-px overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
            <Field label="銘柄 ＊" value={draft.brand} onChange={(v) => set({ brand: v })} placeholder="例: 而今（必須）" />
            <Field label="補足" value={draft.sub_name} onChange={(v) => set({ sub_name: v })} placeholder="例: 山田錦 無濾過生原酒" />
            <Field label="酒蔵 ＊" value={draft.brewery} onChange={(v) => set({ brewery: v })} placeholder="例: 木屋正酒造（必須）" />
            <Field label="都道府県 ＊" value={draft.prefecture} onChange={(v) => set({ prefecture: v })} placeholder="例: 三重県（必須）" />
            <Field label="特定名称 ＊" value={draft.grade} onChange={(v) => set({ grade: v })} placeholder="例: 純米吟醸（必須）" />
            <Field label="価格 (円) ＊" value={draft.price} onChange={(v) => set({ price: v.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="必須" />
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-ink-soft">＊は必須（銘柄・酒蔵・都道府県・特定名称・価格）。情報が無い銘柄はお客様への説明も分析もできません。</p>

          {/* 瓶の容量（90ml提供の杯数目安に使う。1.8L=約20杯・720ml=約8杯） */}
          <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
            <p className="text-[11px] font-bold text-ink-soft">瓶の容量</p>
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
                  {v}（約{v === "1.8L" ? 20 : 8}杯）
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] text-ink-soft">提供90mlグラス換算の目安です。ふつうの一升瓶なら1.8LのままでOK。</p>
          </div>

          <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
            <p className="text-[11px] font-bold text-ink-soft">紹介文（任意）</p>
            <textarea
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              rows={4}
              placeholder="味わいの特徴やおすすめの飲み方など"
              className="mt-2 w-full resize-none rounded-xl bg-paper px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-[#c3c1ba]"
            />
            <label className="mt-3 block text-[11px] font-bold text-ink-soft">
              味わいタグ（カンマ区切り・最大5）
              <input
                value={draft.taste_tags.join("、")}
                onChange={(e) => set({ taste_tags: splitTags(e.target.value) })}
                placeholder="例: フルーティ、華やか、やや甘口"
                className="mt-1 w-full rounded-xl bg-paper px-3 py-2 text-[13px] font-normal outline-none placeholder:text-[#c3c1ba]"
              />
            </label>
            <label className="mt-2 block text-[11px] font-bold text-ink-soft">
              相性の良い料理（カンマ区切り・最大5）
              <input
                value={draft.pairings.join("、")}
                onChange={(e) => set({ pairings: splitTags(e.target.value) })}
                placeholder="例: 刺身、塩焼き、チーズ"
                className="mt-1 w-full rounded-xl bg-paper px-3 py-2 text-[13px] font-normal outline-none placeholder:text-[#c3c1ba]"
              />
            </label>
          </div>

          {/* 味わいチャート（任意・客向け詳細に表示される） */}
          <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
            <p className="text-[11px] font-bold text-ink-soft">味わいチャート（任意・1〜5）</p>
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
            <input
              type="checkbox"
              checked={draft.is_hidden}
              onChange={(e) => set({ is_hidden: e.target.checked })}
              className="h-5 w-5 accent-[#1e3d2f]"
            />
            <span className="text-sm">お客様の一覧に出さない（特別提供用）</span>
          </label>

          <div className="mt-5 flex gap-3">
            <button
              onClick={reset}
              className="rounded-full border border-hairline bg-card px-5 py-4 text-sm text-ink-soft"
            >
              {manual ? "やめる" : "撮り直す"}
            </button>
            <button
              onClick={save}
              disabled={phase === "saving"}
              className="flex-1 rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white shadow-[0_10px_26px_rgba(30,61,47,0.35)] disabled:opacity-50"
            >
              {phase === "saving" ? "登録中..." : "この内容で登録する"}
            </button>
          </div>
          <p className="mt-3 pb-6 text-center text-[11px] text-ink-soft">
            {manual ? "＊の5項目は必須です（わからない項目はAI補完も使えます・あとから編集可）" : "所要時間 約30秒"}
          </p>
        </div>
      )}
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
