// OpenAI 画像生成（店のマスコット「すぎだまる」）。サーバー専用。キーは OPENAI_API_KEY（Vercel env）。
// モデルは OPENAI_IMAGE_MODEL（既定 gpt-image-1。参考画像から描き直す edits は gpt-image-1 のみ）。
// 2026-10-01: 酒神（収集モンスター）の生成はやめた。残っているのは すぎだまる用のプロンプトと生成関数だけ。
import sharp from "sharp";

// 生成画像の軽量化：1024px PNG(~2MB) → 512px WebP(~50KB)。表示はSNSアイコン程度なので512で十分。
export async function toGodArtWebp(buf: Buffer | Uint8Array): Promise<{ data: Buffer; type: string }> {
  const out = await sharp(buf)
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return { data: out, type: "image/webp" };
}

export function openaiImageAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
export function imageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
}
// gpt-image-1 の画質: low/medium/high。既定 medium（見栄え優先・気に入った画質）。
// もし一括生成でタイムアウトが多い時は Vercel env OPENAI_IMAGE_QUALITY=low で速く・安定させられる。
function imageQuality(): string {
  const q = (process.env.OPENAI_IMAGE_QUALITY || "medium").toLowerCase();
  return ["low", "medium", "high", "auto"].includes(q) ? q : "medium";
}

// 店のオリジナルマスコット「すぎだまる」＝杉玉の精（店の顔＝上品でかわいい案内役）。
export function mascotPromptText(): string {
  return `Create ONE original collectible creature mascot — the official store character "Sugidamaru" for a niboshi-ramen and sake izakaya — that FUSES a 杉玉 (sugidama: the round woven cedar-ball hung at sake breweries) with a cute little fish (a niboshi sardine). Design: a plump round body formed of woven deep-green cedar sprigs (a living sugidama cedar-ball), given fish features — small rounded side fins, a forked fish tail, a hint of soft scales, big friendly expressive eyes and an adorable confident face. Mostly GREEN: moss green and deep forest green body with subtle warm gold-leaf accents and a soft glowing aura. Japanese fantasy aesthetic of sake and a sake brewery. Character-centered BUST-UP portrait, softly blurred deep forest-green backdrop, anime-leaning high-quality clean-line illustration with tasteful Japanese ornamentation and a sense of depth, optimized as an SNS icon. Cute and adorable with a rounded lovable face, gender-neutral, a single creature only with an instantly readable iconic silhouette. STRICTLY AVOID any dog or canine elements (no dog, dog ears, snout, shiba, wolf), and avoid text, letters, kanji, logos, watermark, humans, held bottles or cups, gore, broken anatomy, extra fingers, distorted face.`;
}

// アップロードした参考画像を「ベース」にして、すぎだまるを描き直す（gpt-image-1 edits用）。
// 参照キャラの愛らしさ・形は保ちつつ、文字/札/ロゴは必ず除去する。
export function mascotRefinePrompt(): string {
  return `Redraw THIS character cleanly as the official mascot of a niboshi-ramen and sake izakaya: a cute round fuzzy 杉玉 (cedar-ball / sakabayashi) creature with a small wooden gabled-roof cap on top, big shiny friendly eyes, soft rosy cheeks, a happy open smile, tiny mitten hands and little legs with small wooden clogs. Keep the SAME adorable design, proportions and fuzzy woven texture as the reference. KEEP THE EXACT SAME COLORS as the reference image (its warm reddish-brown woven cedar body, cream mittens, dark wood roof and clogs) — do NOT recolor it, do NOT make it green. IMPORTANT: remove ALL text, kanji, letters, name tags, wooden plaques, signboards, logos and watermarks — the character must carry NO writing of any kind. Keep it a single character, centered, full body, clean and high quality, soft even lighting on a plain warm cream background. Charming, premium, gender-neutral.`;
}

// 相談役すぎだまる（眼鏡＋本／自由の女神ポーズ・ペンなし・大きな目・赤いほっぺ）。
// 基本すぎだまるを下敷きに、司書/ソムリエ風の要素だけ足す。
export function mascotAdvisorPrompt(): string {
  return `Redraw THIS exact character as a friendly sake sommelier / librarian-advisor version of itself. Keep the SAME adorable design, the SAME fuzzy round cedar-ball body, wooden roof cap, body COLORS, proportions and texture EXACTLY as the reference. Make these changes: (1) put thin round-framed glasses on its face; (2) make its eyes noticeably BIGGER, rounder and more sparkly than the reference; (3) give it clearly visible rosy-RED blushing cheeks; (4) pose it proudly with ONE mitten arm raised straight UP high overhead, holding a small closed book lifted up aloft (held high like a lantern); the other little hand rests at its side. It must hold a BOOK only — give it NO pen, NO quill, no cup and no bottle. Warm, helpful, knowledgeable expression. Single character, centered, full body, clean and high quality, soft even lighting on a plain warm cream background. The plain book cover and everything else must be BLANK — no text, letters, kanji, numbers, logos or watermarks of any kind.`;
}

// テキストから1枚生成（generations）。
export async function generateImageFromText(prompt: string): Promise<{ data: Buffer; type: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 未設定");
  const model = imageModel();
  const body: Record<string, unknown> =
    model === "gpt-image-1"
      ? { model, prompt, size: "1024x1024", quality: imageQuality(), n: 1 }
      : { model, prompt, size: "1024x1024", quality: "standard", response_format: "b64_json", n: 1 };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openai image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai image: empty response");
  return { data: Buffer.from(b64, "base64"), type: "image/png" };
}

// 参考画像を元に生成（edits・gpt-image-1のみ）。すぎだまるの描き直しに使う。
export async function generateImageFromLabel(label: Buffer, labelType: string, prompt: string): Promise<{ data: Buffer; type: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 未設定");
  if (imageModel() !== "gpt-image-1") throw new Error("from-label needs gpt-image-1");
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("quality", imageQuality());
  form.append("n", "1");
  const ext = (labelType || "").includes("png") ? "png" : "jpg";
  form.append("image", new Blob([new Uint8Array(label)], { type: labelType || "image/jpeg" }), `label.${ext}`);
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` }, // Content-Type は FormData が自動設定
    body: form,
  });
  if (!res.ok) throw new Error(`openai edits ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai edits: empty response");
  return { data: Buffer.from(b64, "base64"), type: "image/png" };
}
