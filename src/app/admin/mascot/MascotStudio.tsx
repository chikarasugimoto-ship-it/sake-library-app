"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";

export function MascotStudio({ currentUrl }: { currentUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [imgs, setImgs] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [savedUrl, setSavedUrl] = useState(currentUrl);
  const [saving, setSaving] = useState<number | null>(null);
  const [refB64, setRefB64] = useState("");
  const [refPreview, setRefPreview] = useState("");
  const [genVariant, setGenVariant] = useState<"base" | "advisor">("base");
  const fileRef = useRef<HTMLInputElement>(null);

  // 参考画像を読み込み → 1024pxに縮小 → base64（PNG）に。これを「ベース」に描き直す。
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/png");
      setRefPreview(dataUrl);
      setRefB64(dataUrl.split(",")[1] || "");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function generate() {
    setBusy(true);
    setErr("");
    setGenVariant("base");
    try {
      const body: Record<string, unknown> = { action: "generate" };
      if (refB64) { body.ref_base64 = refB64; body.ref_type = "image/png"; }
      const r = await fetch("/api/admin/mascot-gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.message || j.error || "生成に失敗しました（OPENAI_API_KEY とモデルをご確認ください）");
      else setImgs(j.images || []);
    } catch {
      setErr("通信に失敗しました");
    }
    setBusy(false);
  }

  // 保存済みの基本すぎだまるを取得して base64 に（相談役の下敷きにする）
  async function fetchBaseAsB64(): Promise<string | null> {
    try {
      const r = await fetch("/api/mascot");
      if (!r.ok) return null;
      const buf = new Uint8Array(await (await r.blob()).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return btoa(bin);
    } catch {
      return null;
    }
  }

  // 相談役すぎだまる（眼鏡＋本・自由の女神ポーズ）を、保存済みの基本すぎだまるを下敷きに3案生成
  async function genAdvisor() {
    setBusy(true);
    setErr("");
    const base = await fetchBaseAsB64();
    if (!base) {
      setErr("先に「基本のすぎだまる」を作成・採用してください（それを下敷きに眼鏡＋本を足します）");
      setBusy(false);
      return;
    }
    setGenVariant("advisor");
    try {
      const r = await fetch("/api/admin/mascot-gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", variant: "advisor", ref_base64: base, ref_type: "image/webp" }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.message || j.error || "生成に失敗しました");
      else setImgs(j.images || []);
    } catch {
      setErr("通信に失敗しました");
    }
    setBusy(false);
  }

  const [savedAdvisor, setSavedAdvisor] = useState("");
  async function save(i: number) {
    setSaving(i);
    setErr("");
    try {
      const r = await fetch("/api/admin/mascot-gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", image_base64: imgs[i], variant: genVariant }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "保存に失敗しました");
      else {
        if (genVariant === "advisor") setSavedAdvisor(`data:image/webp;base64,${imgs[i]}`);
        else setSavedUrl(j.url + "?v=" + (j.ver || "1"));
        setImgs([]);
      }
    } catch {
      setErr("通信に失敗しました");
    }
    setSaving(null);
  }

  return (
    <main className="mx-auto max-w-lg px-6 pb-24 pt-12">
      <Link href="/admin" className="text-xs text-ink-soft">‹ 在庫ボードへ戻る</Link>
      <h1 className="mt-2 text-2xl font-bold">すぎだまる（マスコット）生成</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        店のマスコット「<b className="text-moss-deep">すぎだまる</b>」をAIで作ります。<b>参考画像をアップ</b>すると、その絵を<b>ベース</b>に文字を消したきれいな3案を作ります（無ければテキストから生成）。1回 約$0.04〜0.08・何度でも作り直せます。
      </p>

      {savedUrl && (
        <div className="mt-4 rounded-2xl border border-hairline bg-card p-4">
          <p className="text-[12px] font-bold text-moss-deep">現在のすぎだまる</p>
          <div className="mt-2 flex gap-4">
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={savedUrl} alt="基本のすぎだまる" className="h-28 w-28 rounded-2xl object-cover" />
              <p className="mt-1 text-[10px] text-ink-soft">基本</p>
            </div>
            <div className="text-center">
              {savedAdvisor ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={savedAdvisor} alt="相談役すぎだまる" className="h-28 w-28 rounded-2xl object-cover" />
              ) : (
                <Mascot variant="advisor" size={112} className="rounded-2xl" fallback={<div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-[#f1efe9] text-[10px] text-ink-soft">未作成</div>} />
              )}
              <p className="mt-1 text-[10px] text-ink-soft">相談役（眼鏡＋本）</p>
            </div>
          </div>
        </div>
      )}

      {/* 参考画像（これベースで） */}
      <div className="mt-5 rounded-2xl border border-dashed border-moss bg-[#eef3ef] p-4">
        <p className="text-[12.5px] font-bold text-moss-deep">📷 この画像ベースで作る（おすすめ）</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">気に入った杉玉キャラの画像を選ぶと、それを下敷きに「文字なし」のきれいな版を3案作ります。色・形はなるべくそのまま。</p>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="mt-2 w-full rounded-full border border-moss bg-card py-2.5 text-[12.5px] font-bold text-moss-deep">
          {refB64 ? "✓ 参考画像を選びました（別の画像に変える）" : "参考画像を選ぶ"}
        </button>
        {refPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={refPreview} alt="参考画像" className="mx-auto mt-3 h-40 w-40 rounded-2xl border border-hairline object-contain" />
        )}
      </div>

      <button
        onClick={generate}
        disabled={busy}
        className="mt-4 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "生成中…（1分ほどかかります）" : refB64 ? "🧪 この画像ベースで3案 生成する" : "🧪 テキストから3案 生成する"}
      </button>

      {/* 相談役すぎだまる（眼鏡＋本・自由の女神ポーズ）＝「すぎだまるに相談」ボタンのアイコン */}
      <button
        onClick={genAdvisor}
        disabled={busy}
        className="mt-2 w-full rounded-full border border-moss bg-card py-3 text-[13px] font-bold text-moss-deep disabled:opacity-50"
      >
        🍶 相談役すぎだまる（眼鏡＋本）を作る
      </button>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
        「すぎだまるに相談」ボタンのアイコンになります。<b>採用済みの基本すぎだまるを下敷き</b>に、眼鏡をかけ、自由の女神のように本を高く掲げ、目を大きく・ほっぺを赤くした版を3案作ります（ペンなし／先に基本を採用しておいてください）。
      </p>

      {err && <p className="mt-3 rounded-xl bg-[#fbeceb] px-3 py-2 text-center text-[12px] text-[#b3261e]">{err}</p>}

      {imgs.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4">
          <p className="text-[12px] text-ink-soft">{genVariant === "advisor" ? "相談役（眼鏡＋本）" : "基本"}の3案です。気に入った1枚の「この絵にする」で採用されます。</p>
          {imgs.map((b64, i) => (
            <div key={i} className="rounded-2xl border border-hairline bg-card p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/webp;base64,${b64}`} alt={`案${i + 1}`} className="mx-auto h-56 w-56 rounded-2xl object-cover" />
              <button
                onClick={() => save(i)}
                disabled={saving !== null}
                className="mt-3 w-full rounded-full border border-moss bg-card py-2.5 text-sm font-bold text-moss-deep disabled:opacity-50"
              >
                {saving === i ? "保存中…" : `この絵にする（案${i + 1}）`}
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
