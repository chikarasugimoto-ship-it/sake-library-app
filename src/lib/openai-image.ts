// OpenAI 画像生成（酒神＝収集モンスター）。サーバー専用。キーは OPENAI_API_KEY（Vercel env）。
// モデルは OPENAI_IMAGE_MODEL（既定 gpt-image-1。ラベルから生成＝edits は gpt-image-1 のみ。
// dall-e-3 はテキスト生成のみ＝ラベル参照不可で銘柄名から生成にフォールバック）。
import type { Rarity } from "./sakegami";
import sharp from "sharp";

// 生成画像の軽量化：1024px PNG(~2MB) → 512px WebP(~50KB)。表示はSNSアイコン程度なので512で十分。
// これで「初回・獲得演出で酒神が出るのが遅い」を解消（DB読み出し・変換・転送が一気に軽くなる）。
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

// ===== 部品式プロンプト（固定軸＝世界観一致／可変軸＝多様化／安全軸＝犬禁則・除外）=====
// レア度ごとの「格」（豪華さ）。
const MONSTER_GRAND: Record<Rarity, string> = {
  N: "a small, humble, friendly low-rank creature",
  R: "a charming creature with light ornamentation",
  SR: "a refined creature with intricate detailing",
  SSR: "a majestic, divine-looking creature with golden ornaments",
  UR: "a powerful, imposing creature radiating overwhelming golden energy",
  LR: "a legendary, awe-inspiring divine beast of overwhelming presence and brilliant gold",
};

// 可変軸カタログ（多様性。sake_idで決定論的に選ぶ＝同じ銘柄は毎回同じ作風）
const TONE = [
  "cute and adorable (rounded, lovable face)",
  "cool and striking (sharp gaze, heavy ornaments)",
  "wistful and emotional (night mood, glowing light particles)",
  "solemn and divine (ceremonial, sacred)",
  "a touch comical and charming (endearing, slightly goofy)",
];
const GENDER = ["graceful and elegant", "bold and powerful", "androgynous and refined"];
const PROPS = [
  "a glowing sake cup motif",
  "flowing steam shaped like flowers or a dragon",
  "luminous koji rice-flowers",
  "rice ears woven as ornament",
  "a floating paper talisman (ofuda) ward",
  "drifting cherry petals",
  "delicate snow crystals",
  "a softly chiming wind-bell",
];
const EXPRESSION = ["sparkling determined eyes", "a dignified calm gaze", "a confident smirk", "gentle teary glimmer", "a charming troubled look"];
const POSE = ["holding up a cup-like motif", "a ceremonial dignified stance", "kneeling on one knee, heroic", "floating gently, reaching out a hand"];

// レア度＝グレードで背景/オーラを色分け（深いトーンで統一・キャラ本体の色はラベル由来）
const RARITY_BG: Record<Rarity, string> = {
  N: "a calm dark slate-green backdrop, subtle",
  R: "a deep forest-green backdrop",
  SR: "a deep green backdrop with soft bronze rim light",
  SSR: "a dark backdrop with rich golden rim light, elegant",
  UR: "a deep royal indigo-purple backdrop with a golden glow",
  LR: "a black backdrop with brilliant gold and a faint rainbow radiance, divine",
};

function pick<T>(arr: T[], seed: number, salt: number): T {
  return arr[Math.abs((seed * 131 + salt * 977) % arr.length)];
}
function seasonBg(season?: string): string {
  const s = season || "";
  if (/春|桜/.test(s)) return "soft cherry-blossom petals drifting, spring";
  if (/夏|涼/.test(s)) return "a quiet summer night with faint wind-chimes";
  if (/秋|紅葉/.test(s)) return "warm autumn-leaf lantern light";
  if (/冬|雪/.test(s)) return "snow-lit winter atmosphere";
  return "soft golden mist (subtle)";
}

// 固定軸＋安全軸（犬禁則・除外はプロンプト本文に折り込む＝OpenAIにnegative欄は無いため）
const FIXED = [
  "Japanese fantasy aesthetic of sake and a sake brewery. Character-centered, BUST-UP portrait (head and upper body), softly blurred background, optimized as an SNS icon.",
  "High-quality clean-line illustration, anime-leaning, sense of depth, tasteful Japanese ornamentation. A single creature only.",
];
const BAN = "STRICTLY AVOID any dog elements: no dog, no dog ears, no dog snout, no Shiba Inu, no Corgi, no Golden Retriever, no Husky, no wolf, no canine features. Also avoid: text, letters, kanji, logos, watermark, human, bottle, cup-as-object held in hands, gore, broken anatomy, extra fingers, distorted face.";

export type GodArtOpts = { brand: string; rarity: Rarity; seed: number; season?: string };

function variableBlock(o: GodArtOpts): string {
  const r = o.rarity || "N";
  const season = o.season ? ` with a subtle hint of ${seasonBg(o.season)}` : "";
  return [
    `Rarity ${r}: ${MONSTER_GRAND[r] || MONSTER_GRAND.N}.`,
    `Tone: ${pick(TONE, o.seed, 1)}.`,
    `Vibe: ${pick(GENDER, o.seed, 2)}.`,
    `Subtle motif: ${pick(PROPS, o.seed, 3)}.`,
    `Expression: ${pick(EXPRESSION, o.seed, 4)}.`,
    `Pose: ${pick(POSE, o.seed, 5)}.`,
    // 背景/オーラ＝レア度で色分け（グレード色分け）。キャラ本体の色はラベル/その性質に合わせる。
    `Background and aura color = rarity grade: ${RARITY_BG[r] || RARITY_BG.N}${season}, softly blurred, not distracting.`,
    "The creature's OWN body colors should suit its nature and the sake label (do not force the creature to be yellow).",
  ].join(" ");
}

// ラベルから生成（形はラベル由来＝多様性はラベル＋可変軸で出す。犬禁則を必ず入れる）。
export function monsterPromptFromLabel(o: GodArtOpts): string {
  return `Create ONE original collectible CREATURE mascot (a "sake guardian creature") inspired by THIS Japanese sake label — reimagine the label's colors, motifs, animals/plants and atmosphere into a SINGLE creature (do not copy the label, do not include the label). ${FIXED.join(" ")} ${variableBlock(o)} ${BAN}`;
}

// ラベル無し/ dall-e-3 用（銘柄名から）。
export function monsterPromptText(o: GodArtOpts): string {
  return `Create ONE original collectible CREATURE mascot (a "sake guardian creature") inspired by the spirit and name of a Japanese sake called "${o.brand}". ${FIXED.join(" ")} ${variableBlock(o)} ${BAN}`;
}

// 店のオリジナルマスコット「すぎだまる」＝杉玉の精。酒神モンスターとは別系統の専用プロンプト
// （犬禁則やバストアップ等の酒神軸は使わない。店の顔＝上品でかわいい案内役）。
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

// テキストから1枚生成（generations）。ラベル無し/ dall-e-3 用。
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

// ラベル画像を参照して生成（edits・gpt-image-1のみ）。ラベルの世界観を持つモンスターになる。
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
