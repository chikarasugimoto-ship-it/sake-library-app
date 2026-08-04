import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_MODEL = "claude-opus-4-8";
// 英訳は単純作業なので高速・低コストの Sonnet を使う（Opusだと遅くタイムアウトしやすい）
const TRANSLATE_MODEL = "claude-sonnet-4-6";

export const TASTE_TAGS = [
  "辛口",
  "甘口",
  "フルーティ",
  "濃厚",
  "スッキリ",
  "酸味",
  "微発泡",
  "旨口",
  "華やか",
  "初心者向け",
] as const;

export const PAIRINGS = [
  "煮干しラーメンに合う",
  "炙りチャーシューに合う",
  "和え玉に合う",
  "日本酒初心者向け",
  "食中酒に",
  "デザート酒に",
] as const;

export type LabelResult = {
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  taste_tags: string[];
  pairings: string[];
  taste_chart: { sweet: number; acid: number; aroma: number; sharp: number };
  description: string;
  label_color: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number }; // 写真内の瓶の範囲（0〜1の割合）
};

const SYSTEM = `あなたは日本酒に精通したソムリエ兼データ入力の専門家です。
ラベル写真から日本酒を特定し、JSONだけを返します。説明文や前置きは一切不要です。

返すJSONの形式:
{
  "brand": "銘柄名（例: 而今）",
  "sub_name": "銘柄の補足（例: 純米吟醸 山田錦 / 無ければ空文字）",
  "brewery": "酒蔵名（例: 木屋正酒造)",
  "prefecture": "都道府県（例: 三重県）",
  "grade": "特定名称（純米大吟醸/純米吟醸/特別純米/純米/本醸造/普通酒 のいずれか。不明なら空文字）",
  "taste_tags": [${TASTE_TAGS.map((t) => `"${t}"`).join(", ")} から1〜3個],
  "pairings": [],
  "taste_chart": { "sweet": 0-5, "acid": 0-5, "aroma": 0-5, "sharp": 0-5 },
  "description": "この銘柄そのものの紹介文（150〜200字）。蔵元・産地・原料米・造り・味わいの個性・銘柄の背景や定評を具体的に書き、お客様が「飲んでみたい」と思う魅力的な文に。銘柄ごとに必ず内容を変える。料理のペアリングや店のメニューには一切触れない。確証のない数値は断定しない",
  "label_color": "瓶またはラベルの代表色のHEX（例: #1e3d2f）",
  "confidence": 銘柄特定の確信度 0.0-1.0,
  "bbox": { "x": 0〜1, "y": 0〜1, "w": 0〜1, "h": 0〜1 }
}

bbox は写真の中で「日本酒の瓶（ラベルを含む本体）」が占める範囲です。
画像全体の幅・高さを1.0としたときの、x=左端, y=上端, w=幅, h=高さ の割合で返してください。
瓶の上端から底まで縦に収まるよう、瓶を囲む最小の長方形を返します。背景や他の物は含めないでください。
瓶が判別できない場合は { "x":0,"y":0,"w":1,"h":1 } を返してください。

銘柄が読み取れない場合も、見える情報から最善の推定をし、confidenceを低くしてください。`;

export function aiAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function recognizeLabel(imageBase64: string, mediaType: string): Promise<LabelResult> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
              data: imageBase64,
            },
          },
          { type: "text", text: "このラベルの日本酒を特定し、指定のJSONで返してください。" },
        ],
      },
    ],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AIの応答を解析できませんでした");
  const raw = JSON.parse(match[0]) as Partial<LabelResult>;
  const clamp = (n: unknown) => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return {
    brand: String(raw.brand ?? "").slice(0, 60),
    sub_name: String(raw.sub_name ?? "").slice(0, 60),
    brewery: String(raw.brewery ?? "").slice(0, 60),
    prefecture: String(raw.prefecture ?? "").slice(0, 10),
    grade: String(raw.grade ?? "").slice(0, 20),
    taste_tags: (raw.taste_tags ?? []).filter((t): t is (typeof TASTE_TAGS)[number] =>
      (TASTE_TAGS as readonly string[]).includes(String(t))
    ).slice(0, 3),
    pairings: [], // 料理ペアリングは表示しない（メニューに無い物を出さないため）
    taste_chart: {
      sweet: clamp(raw.taste_chart?.sweet),
      acid: clamp(raw.taste_chart?.acid),
      aroma: clamp(raw.taste_chart?.aroma),
      sharp: clamp(raw.taste_chart?.sharp),
    },
    description: String(raw.description ?? "").slice(0, 300),
    label_color: /^#[0-9a-fA-F]{6}$/.test(String(raw.label_color)) ? String(raw.label_color) : "#1e3d2f",
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    bbox: normalizeBbox(raw.bbox),
  };
}

// 銘柄を特定後、複数サイトをWeb検索して「飲みたくなる」魅力的な紹介文を生成
export async function describeSake(info: {
  brand: string;
  subName?: string;
  brewery?: string;
  prefecture?: string;
  grade?: string;
}): Promise<string> {
  if (!aiAvailable() || !info.brand) return "";
  const client = new Anthropic();
  const q = [info.brand, info.subName, info.brewery, info.prefecture, info.grade].filter(Boolean).join(" ");
  const SYS = `あなたは日本酒の魅力を伝えるリサーチャー兼コピーライターです。
指定された日本酒について、複数のWebサイト（蔵元公式・酒販店・レビュー・専門メディア等）を検索して情報を集め、お客様が「飲んでみたい」と思う紹介文を1つ書きます。
- 蔵元・産地・原料米・造りの特徴・味わいの個性・銘柄の背景や定評など、その銘柄ならではの具体的な魅力を盛り込む。
- 150〜220字。上品で、飲んでみたくなる表現。銘柄ごとに内容は必ず異なる。
- 料理のペアリングや特定の店のメニューには触れない（日本酒そのものの魅力だけ）。
- 不確実な数値や受賞歴は断定しない。
- 【重要】検索後の最終出力は「紹介文の本文1段落のみ」。『調べます』『〜について』等の前置き、区切り線(---)、字数・出典の記載は絶対に含めない。いきなり紹介文から書き始める。`;
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYS,
      // Anthropic サーバー側Web検索ツール（複数サイトから情報収集）
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] as unknown as Anthropic.Tool[],
      messages: [{ role: "user", content: `次の日本酒の魅力的な紹介文を書いてください（本文のみ）: ${q}` }],
    });
    let text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    // 整形：区切り線で囲まれていれば最長ブロックを採用 → 前置き/字数表記を除去
    let segs = text.split(/-{3,}/).map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      // メタ（検索の説明・字数表記など）のセグメントを除外し、本文の最長を採る
      const nonMeta = segs.filter((s) => !/調べ|紹介文です|を紹介します|^\s*[（(]?\s*約?\s*\d+\s*字|^(?:I['’]?ll|I will|Let me|Here|Okay|Sure)/i.test(s));
      segs = nonMeta.length ? nonMeta : segs;
      text = segs.reduce((a, b) => (b.length > a.length ? b : a));
    }
    text = text
      // 英語の前置き（I'll research… / Let me / Here's など）
      .replace(/^\s*(?:I['’]?ll|I will|Let me|Sure[!,.]?|Here(?:'s| is)|Okay[,!.]?|I['’]?ve)\b[^\n。]*?[.。]\s*/i, "")
      // 日本語の前置き（〜について調べ… / 調べてみます。 等）
      .replace(/^[\s\S]*?(?:について調べ[^。]*。|を調べ[^。]*。|調べてみます。|紹介文です。|を紹介します。)\s*/, "")
      // 末尾の字数表記
      .replace(/[（(]\s*約?\s*\d+\s*字[^)）]*[)）]\s*$/g, "")
      .trim();
    return text.slice(0, 400);
  } catch {
    return ""; // 検索不可・エラー時は空（呼び出し側でフォールバック）
  }
}

// ===== 銘柄・県・酒蔵（正しい確定情報）から、残りの項目をAIが入れ直す =====
// ラベル誤認識の修正用。brand/prefecture/brewery は変更せず、それを手がかりに
// 特定名称・味わいタグ・味わいチャート・紹介文・代表色を生成する。
export type TextEnrich = {
  grade: string;
  sub_name: string;
  taste_tags: string[];
  taste_chart: { sweet: number; acid: number; aroma: number; sharp: number };
  description: string;
  label_color: string;
};

export async function enrichSakeFromText(info: {
  brand: string;
  prefecture?: string;
  brewery?: string;
  subName?: string;
}): Promise<TextEnrich> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  if (!info.brand?.trim()) throw new Error("銘柄を入れてください");
  const client = new Anthropic();
  const q = [info.brand, info.subName, info.brewery, info.prefecture].filter(Boolean).join(" ");
  const SYS = `あなたは日本酒に精通したソムリエ兼データ入力の専門家です。
与えられた「銘柄・都道府県・酒蔵」は人が確認した正しい確定情報です（推測し直さない・変更しない）。その銘柄について調べ、JSONだけを返します。前置き・説明・コードフェンスは一切不要。

返すJSONの形式:
{
  "grade": "特定名称（純米大吟醸/純米吟醸/特別純米/純米/本醸造/普通酒 のいずれか。確証がなければ空文字）",
  "sub_name": "銘柄の補足（例: 山田錦 無濾過生原酒 / 不明なら空文字）",
  "taste_tags": [${TASTE_TAGS.map((t) => `"${t}"`).join(", ")} から1〜3個],
  "taste_chart": { "sweet": 1-5, "acid": 1-5, "aroma": 1-5, "sharp": 1-5 },
  "description": "この銘柄そのものの紹介文（150〜200字）。蔵元・産地・原料米・造り・味わいの個性を具体的に。料理ペアリングや店のメニューには一切触れない。",
  "label_color": "瓶またはラベルの代表色のHEX（例: #1e3d2f）"
}
確証のない数値や受賞歴は断定しない。与えられた酒蔵・都道府県と矛盾する内容は書かない。`;
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system: SYS,
    messages: [{ role: "user", content: `次の日本酒の情報をJSONで返してください: ${q}` }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AIの応答を解析できませんでした");
  const raw = JSON.parse(match[0]) as Partial<TextEnrich>;
  const clamp = (n: unknown) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  const out: TextEnrich = {
    grade: String(raw.grade ?? "").slice(0, 20),
    sub_name: String(raw.sub_name ?? "").slice(0, 60),
    taste_tags: (raw.taste_tags ?? [])
      .filter((t): t is string => (TASTE_TAGS as readonly string[]).includes(String(t)))
      .slice(0, 3),
    taste_chart: {
      sweet: clamp(raw.taste_chart?.sweet),
      acid: clamp(raw.taste_chart?.acid),
      aroma: clamp(raw.taste_chart?.aroma),
      sharp: clamp(raw.taste_chart?.sharp),
    },
    description: String(raw.description ?? "").slice(0, 400),
    label_color: /^#[0-9a-fA-F]{6}$/.test(String(raw.label_color)) ? String(raw.label_color) : "#1e3d2f",
  };
  // 紹介文はWeb検索で裏取りしたものを優先（失敗時は上のJSONの説明を使う）
  try {
    const researched = await describeSake({
      brand: info.brand,
      subName: info.subName,
      brewery: info.brewery,
      prefecture: info.prefecture,
      grade: out.grade,
    });
    if (researched) out.description = researched;
  } catch {}
  return out;
}

// ===== 日本酒情報の英訳（インバウンド対応・一括） =====
export type SakeTranslateIn = {
  id: number;
  brand: string;
  subName?: string;
  brewery?: string;
  prefecture?: string;
  grade?: string;
  description?: string;
  tasteTags?: string[];
  pairings?: string[];
  kuchijo?: string; // 酒神の口上（あれば英訳）
};
export type SakeTranslateOut = {
  id: number;
  en: { brand: string; subName: string; brewery: string; prefecture: string; grade: string; description: string; tasteTags: string[]; pairings: string[] };
  kuchijoEn: string;
};

// 複数銘柄を1回のAI呼び出しでまとめて英訳（コスト・速度のため呼び出し側で分割）。
export async function translateSakesToEn(items: SakeTranslateIn[]): Promise<SakeTranslateOut[]> {
  if (!aiAvailable() || items.length === 0) return [];
  const client = new Anthropic();
  const SYS = `You are a professional Japanese→English translator specializing in sake (日本酒) for inbound tourists at a Tokyo izakaya. Translate the given sake fields into natural, appetizing English that helps a foreign guest understand and want to try it. Return ONLY a JSON array, no prose, no code fences.
Rules:
- brand: romanize the sake name (例: 而今→"Jikon", 醸し人九平次→"Kamoshibito Kuheiji"). Keep it as the recognizable name.
- prefecture: English place name (三重県→"Mie"). brewery: romaji/English of the brewery (木屋正酒造→"Kiyomasa Brewery" 程度で可).
- grade 特定名称: standard English (純米大吟醸→"Junmai Daiginjo", 純米吟醸→"Junmai Ginjo", 特別純米→"Tokubetsu Junmai", 純米→"Junmai", 本醸造→"Honjozo", 普通酒→"Futsushu"). 空は空。
- tasteTags / pairings: translate each item concisely; keep the SAME array length and order.
- description / kuchijo: fluent natural English, similar length, do NOT invent facts or awards.
- STRICT JSON only: double-quoted keys and strings, escape any " inside strings as \\", NO trailing commas, no comments, no extra prose.
- Output a JSON array, one object per input id, EXACT shape:
[{"id":<id>,"en":{"brand":"","subName":"","brewery":"","prefecture":"","grade":"","description":"","tasteTags":[],"pairings":[]},"kuchijoEn":""}]`;
  const payload = items.map((it) => ({
    id: it.id,
    brand: it.brand,
    subName: it.subName || "",
    brewery: it.brewery || "",
    prefecture: it.prefecture || "",
    grade: it.grade || "",
    description: it.description || "",
    tasteTags: it.tasteTags || [],
    pairings: it.pairings || [],
    kuchijo: it.kuchijo || "",
  }));
  const res = await client.messages.create({
    model: TRANSLATE_MODEL,
    max_tokens: 8000,
    system: SYS,
    messages: [{ role: "user", content: "Translate these sake entries to English. Return the JSON array only:\n" + JSON.stringify(payload) }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("AIの応答を解析できませんでした");
  // AIが時々入れる末尾カンマ等を除去してから解析（「Expected double-quoted property name」対策）
  const cleaned = m[0].replace(/,\s*([}\]])/g, "$1");
  const raw = JSON.parse(cleaned) as Array<{ id: number; en?: Partial<SakeTranslateOut["en"]>; kuchijoEn?: string }>;
  return raw
    .map((r) => ({
      id: Number(r.id),
      en: {
        brand: String(r.en?.brand ?? ""),
        subName: String(r.en?.subName ?? ""),
        brewery: String(r.en?.brewery ?? ""),
        prefecture: String(r.en?.prefecture ?? ""),
        grade: String(r.en?.grade ?? ""),
        description: String(r.en?.description ?? "").slice(0, 600),
        tasteTags: Array.isArray(r.en?.tasteTags) ? r.en!.tasteTags.map(String).slice(0, 8) : [],
        pairings: Array.isArray(r.en?.pairings) ? r.en!.pairings.map(String).slice(0, 8) : [],
      },
      kuchijoEn: String(r.kuchijoEn ?? "").slice(0, 300),
    }))
    .filter((r) => Number.isInteger(r.id));
}

// ===== 酒神メタの一括生成：産地/蔵元を補完し、酒神名＋口上を作る =====
export type GodMetaIn = { id: number; brand: string; grade?: string; brewery?: string; prefecture?: string };
export type GodMetaOut = { id: number; prefecture?: string; brewery?: string; godName?: string; kuchijo?: string };

// 複数銘柄を1回のAI呼び出しでまとめて生成（コスト・速度のため最大40件ずつ呼び出し側で分割）。
// 産地/蔵元は「分かるものだけ」補完（不明は空＝でっち上げない）。酒神名＝二字+神、口上＝30字以内の詩的一文。
export async function enrichGodMeta(sakes: GodMetaIn[]): Promise<GodMetaOut[]> {
  if (!aiAvailable() || sakes.length === 0) return [];
  const client = new Anthropic();
  const list = sakes
    .map((s) => `id:${s.id} | ${s.brand}${s.grade ? " " + s.grade : ""}${s.brewery ? `（蔵:${s.brewery}）` : ""}${s.prefecture ? `（${s.prefecture}）` : ""}`)
    .join("\n");
  const SYS = `あなたは日本酒に非常に詳しい専門家です。各銘柄について次を返します（JSONのみ・前置き不要）:
- prefecture: その銘柄の蔵元の所在「都道府県」。確実に知っている場合のみ（例「山形」）。不明なら空文字。推測でのでっち上げ禁止。
- brewery: 蔵元名。確実に知っている場合のみ。不明なら空文字。
- godName: その酒に宿る「酒神獣（モンスター）」の名。ポケモン的な響きの良い創作名（カタカナ/和風造語・3〜6文字）。**「神」で終わらせない**。銘柄の由来・味・蔵の個性から創作。
- kuchijo: そのモンスターの図鑑説明。25字以内・特徴を詩的な一文で。
形式: {"gods":[{"id":数値, "prefecture":"", "brewery":"", "godName":"", "kuchijo":""}, ...]}
全銘柄ぶん返す。godName/kuchijo は必ず作る。prefecture/brewery は確実なものだけ。`;
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYS,
      messages: [{ role: "user", content: `次の日本酒それぞれに酒神メタを付けてください:\n${list}` }],
    });
    const txt = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const raw = JSON.parse(m[0]) as { gods?: { id?: number; prefecture?: string; brewery?: string; godName?: string; kuchijo?: string }[] };
    const valid = new Set(sakes.map((s) => s.id));
    return (raw.gods ?? [])
      .map((g) => ({
        id: Number(g.id),
        prefecture: String(g.prefecture ?? "").trim().slice(0, 10),
        brewery: String(g.brewery ?? "").trim().slice(0, 30),
        godName: String(g.godName ?? "").trim().slice(0, 20),
        kuchijo: String(g.kuchijo ?? "").trim().slice(0, 60),
      }))
      .filter((g) => valid.has(g.id));
  } catch {
    return [];
  }
}

// ===== 酒神モンスターの名前生成（1銘柄ずつ・創作モンスター名）=====
export async function generateMonsterName(sake: { brand: string; grade?: string; prefecture?: string; rarity?: string }): Promise<{ name: string; kuchijo: string }> {
  if (!aiAvailable() || !sake.brand) return { name: "", kuchijo: "" };
  const client = new Anthropic();
  const SYS = `あなたは収集モンスターゲーム（ポケモン等）のネーミング担当です。日本酒に宿る「酒神獣（しゅしんじゅう）」というモンスターの名前を1体ぶん考えます。
ルール:
- 響きの良い創作モンスター名。カタカナ、または和風の造語。3〜6文字程度。
- **「神」で終わらせない**。「◯◯の神」のような平凡な名前は禁止。ポケモン的な固有名詞にする。
- 銘柄名・産地・レア度の雰囲気を反映する（高レア度ほど強そう・神秘的）。
- あわせて図鑑の一行説明（kuchijo・25字以内・そのモンスターの特徴を詩的に）も作る。
JSONのみ返す（前置き不要）。形式: {"name":"カタカナ等の名前", "kuchijo":"一行説明"}`;
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      system: SYS,
      messages: [{ role: "user", content: `日本酒「${sake.brand}${sake.grade ? " " + sake.grade : ""}」（${sake.prefecture || "産地不明"}・レア度${sake.rarity || "N"}）に宿る酒神獣の名前を考えてください。` }],
    });
    const txt = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return { name: "", kuchijo: "" };
    const raw = JSON.parse(m[0]) as { name?: string; kuchijo?: string };
    return { name: String(raw.name ?? "").trim().slice(0, 20), kuchijo: String(raw.kuchijo ?? "").trim().slice(0, 60) };
  } catch {
    return { name: "", kuchijo: "" };
  }
}

// ===== メニュー（品書き）一括スキャン：1枚から複数の日本酒を抽出 =====
export type MenuSakeItem = {
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: number | null;
};

const MENU_SYSTEM = `あなたは日本酒に精通したソムリエです。
これは飲食店の「日本酒の品書き（メニュー）」の写真です。手書き・縦書き・崩し字の場合もあります。
そこに書かれている日本酒を**すべて**読み取り、JSONだけを返します（説明や前置きは不要）。

形式:
{ "items": [
  { "brand":"銘柄名", "sub_name":"補足(特定名称以外の補足/空可)", "brewery":"酒蔵名(分かれば/空可)", "prefecture":"都道府県(分かれば/空可)", "grade":"特定名称(純米大吟醸など/空可)", "price": 価格(数値/不明はnull) }
] }

注意:
- 日本酒（清酒）のみ。ビール・サワー・焼酎・ソフトドリンク・料理は含めない。
- 銘柄名は正確に。蔵や県が知識から補完できる場合は補ってよい（自信が無ければ空文字）。
- 価格が「90ml ¥1000」等で書かれていれば数値部分(1000)を price に。
- 読み取れた銘柄は漏れなく列挙する。`;

export async function recognizeMenu(imageBase64: string, mediaType: string): Promise<MenuSakeItem[]> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system: MENU_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 } },
          { type: "text", text: "この品書きに載っている日本酒をすべて抽出し、指定JSONで返してください。" },
        ],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AIの応答を解析できませんでした");
  const raw = JSON.parse(match[0]) as { items?: Partial<MenuSakeItem>[] };
  return (raw.items ?? [])
    .map((it) => ({
      brand: String(it.brand ?? "").slice(0, 60),
      sub_name: String(it.sub_name ?? "").slice(0, 60),
      brewery: String(it.brewery ?? "").slice(0, 60),
      prefecture: String(it.prefecture ?? "").slice(0, 10),
      grade: String(it.grade ?? "").slice(0, 20),
      price: it.price != null && !isNaN(Number(it.price)) ? Number(it.price) : null,
    }))
    .filter((it) => it.brand);
}

// ===== AIソムリエ：本日の在庫から好みに合う一本を提案 =====
export type SakeForRec = {
  id: number;
  brand: string;
  grade: string;
  prefecture: string;
  price: number | null;
  isPremium: boolean;
  tasteTags: string[];
  tasteChart: { sweet: number; acid: number; aroma: number; sharp: number };
  description: string;
  fresh?: boolean; // 生酒など開栓後に味が落ちやすい＝今が飲みごろの酒
  openDays?: number | null; // 開栓からの経過日数（鮮度の急ぎ具合。null=未開栓/不明）
};
export type Recommendation = { sakeId: number; reason: string };

export async function recommendSake(prefs: string[], text: string, sakes: SakeForRec[], lang: "ja" | "en" = "ja"): Promise<Recommendation[]> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  if (sakes.length === 0) return [];
  const client = new Anthropic();
  const list = sakes
    .map(
      (s) =>
        `id:${s.id} | ${s.brand}${s.grade ? " " + s.grade : ""}（${s.prefecture}） ¥${s.price ?? "-"}${s.isPremium ? "（プレミアム）" : ""}${s.fresh ? `〔生酒系・開栓後はお早め${s.openDays != null && s.openDays >= 1 ? `／開栓${s.openDays}日目` : ""}〕` : ""} 味:${s.tasteTags.join("/") || "—"} 甘${s.tasteChart.sweet}/酸${s.tasteChart.acid}/香${s.tasteChart.aroma}/キレ${s.tasteChart.sharp} | ${s.description}`
    )
    .join("\n");
  const wish = [prefs.join("、"), text.trim()].filter(Boolean).join(" / ") || "おまかせ";
  const reasonSpec = lang === "en"
    ? `"reason":"why it suits this guest — natural, friendly English, under ~90 characters"`
    : `"reason":"なぜその人に合うかを45字以内でやさしく具体的に"`;
  const sys = `あなたは煮干しラーメンと日本酒の店のソムリエです。お客様の好みに最も合う日本酒を、下記「本日の在庫リスト」の中から**最大3本**選びます。
リストに無い銘柄は絶対に選ばないこと（sakeIdは必ずリストのidを使う）。JSONだけを返す（前置き不要）。
形式: {"recommendations":[{"sakeId": リストのid(数値), ${reasonSpec}}]}
${lang === "en" ? "Write EVERY reason in natural, friendly English (the guest is an English speaker)." : ""}
好みが曖昧・おまかせの場合は、初心者にも飲みやすい人気傾向の一本を中心に選ぶ。
価格の扱い: お客様の予算感に配慮しつつ、3本選ぶなら**必ず手頃な価格帯を1本以上含める**（押し売りしない）。お客様が「贅沢」「プレミアム」等を希望した時、または特別な味の魅力がある時は、プレミアム（やや高価格）の一本を「せっかくの一杯に」と1本だけ加えてよい。価格を煽る表現や「絶対お得」等の誇張はしない。
鮮度: 〔生酒系〕と付いた酒は生酒・にごり・無濾過生など開栓後に味が変わりやすく「今が飲みごろ」の酒。お客様が「新鮮」「フレッシュ」「生酒」「しぼりたて」等を好むとき、またはおまかせのときは、飲みごろのこの一本をそっと薦めてよい（特に開栓から日が経った酒は理由に『お早めに』と一言添える）。ただし好みに合わなければ無理に入れないこと。`;
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: sys,
    messages: [{ role: "user", content: `お客様の好み: ${wish}\n\n本日の在庫:\n${list}` }],
  });
  const txt = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return [];
  const raw = JSON.parse(m[0]) as { recommendations?: { sakeId?: number; reason?: string }[] };
  const valid = new Set(sakes.map((s) => s.id));
  return (raw.recommendations ?? [])
    .map((r) => ({ sakeId: Number(r.sakeId), reason: String(r.reason ?? "").slice(0, lang === "en" ? 160 : 80) }))
    .filter((r) => valid.has(r.sakeId))
    .slice(0, 3);
}

// ===== AI仕入れアドバイザー：注文実績＋お客様の好み（AI相談）＋在庫から仕入れ提案 =====
export type PurchaseData = {
  orders: { name: string; tasteTags: string[]; qty: number }[]; // 注文の多い順
  aiPrefs: { pref: string; count: number }[]; // AI相談で選ばれた好みチップの回数
  aiTexts: string[]; // AI相談の自由入力（最近のサンプル）
  aiPicked: { name: string; count: number }[]; // AIが薦めた回数
  stock: { name: string; tasteTags: string[]; status: string }[]; // 現在の在庫
  soldoutSpeed: { name: string; days: number }[]; // 完売した銘柄の消化日数（速い順）
  slowMovers: { name: string; days: number }[]; // 在庫が長い銘柄（入荷からの経過日数・遅い順）
  days: number; // 集計対象の日数
};
export type PurchaseInsight = { summary: string; suggestions: { title: string; detail: string }[] };

export async function analyzePurchasing(d: PurchaseData): Promise<PurchaseInsight> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const client = new Anthropic();
  const fmt = (arr: { name?: string; pref?: string; count?: number; qty?: number; tasteTags?: string[]; status?: string }[]) =>
    arr.length ? arr.map((x) => `・${x.name ?? x.pref}${x.qty != null ? ` 注文${x.qty}` : ""}${x.count != null ? ` ${x.count}回` : ""}${x.tasteTags ? `（味:${x.tasteTags.join("/") || "—"}${x.status ? "・" + x.status : ""}）` : ""}`).join("\n") : "（データなし）";
  const sys = `あなたは日本酒バー「煮干しと日本酒 すぎだま」の仕入れアドバイザーです。
注文実績・お客様がAIソムリエに伝えた好み・現在の在庫を踏まえ、「次に何を仕入れる／補充すべきか」を経営者に助言します。
- よく注文される銘柄＝補充候補。お客様の好み（チップ・自由文）に多いのに在庫が手薄な味の傾向＝仕入れ候補。AIがよく薦める＝人気傾向。
- 売切が続く人気銘柄、逆にAI相談で求められているのに無い味（例:フルーティ希望が多いのに在庫が辛口ばかり）を指摘。
- 消化日数：完売までが短い銘柄＝需要が高く品切れの機会損失が出やすい→優先的に補充/多めに仕入れ。入荷から日数が経っても在庫が残る銘柄＝動きが鈍い→追加仕入れは慎重に、味の傾向が外れている可能性。
- データが少ない場合は断定せず「傾向の芽」として控えめに。具体的な銘柄名や味の方向で。
JSONのみ返す（前置き不要）:
{"summary":"全体傾向のひとこと（60字以内）","suggestions":[{"title":"短い見出し","detail":"具体的な助言と理由（90字以内）"}]}
suggestions は2〜5個。`;
  const user = `【集計期間】直近${d.days}日
【注文の多い銘柄】\n${fmt(d.orders)}
【AI相談で選ばれた好み】\n${fmt(d.aiPrefs)}
【AI相談の自由入力(最近)】\n${d.aiTexts.length ? d.aiTexts.map((t) => "・" + t).join("\n") : "（なし）"}
【AIが薦めた銘柄】\n${fmt(d.aiPicked)}
【完売までの日数(速い＝人気)】\n${d.soldoutSpeed.length ? d.soldoutSpeed.map((x) => `・${x.name}：${x.days === 0 ? "当日" : x.days + "日"}で完売`).join("\n") : "（まだ完売データなし）"}
【在庫が長い銘柄(入荷からの日数)】\n${d.slowMovers.length ? d.slowMovers.map((x) => `・${x.name}：入荷${x.days}日目`).join("\n") : "（なし）"}
【現在の在庫】\n${fmt(d.stock)}`;
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const txt = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { summary: "分析できませんでした。", suggestions: [] };
  const raw = JSON.parse(m[0]) as Partial<PurchaseInsight>;
  return {
    summary: String(raw.summary ?? "").slice(0, 120),
    suggestions: (raw.suggestions ?? []).slice(0, 5).map((s) => ({
      title: String(s.title ?? "").slice(0, 40),
      detail: String(s.detail ?? "").slice(0, 160),
    })),
  };
}

// ===== 納品書/領収書スキャン：明細から銘柄・容量・仕入単価を抽出（写真・PDF対応） =====
export type InvoiceItem = {
  brand: string;
  bottle_size: string;
  cost_excl_tax: number | null;
  qty: number;
  confidence: number; // 0-1：この明細を正しく読めた自信（手書き/かすれ/不鮮明で低下）
  uncertain: string[]; // 自信のないフィールド: "brand"|"bottle_size"|"cost_excl_tax"|"qty"
};
export type InvoiceScanResult = {
  supplier: string;
  items: InvoiceItem[];
  quality: "good" | "fair" | "low"; // 書類/写真全体の判読しやすさ
  note: string; // 読み取り上の注意（空可）
};

const INVOICE_SYSTEM = `これは酒類の「納品書」または「領収書」の写真またはPDFです。手書き・印字どちらもあり得ます。
そこに書かれた**日本酒（清酒）**の明細を読み取り、JSONだけ返します（前置き不要）。
形式:
{ "supplier": "仕入先名(分かれば/空可)",
  "quality": "good | fair | low",
  "note": "読み取り上の注意（例: 右端が見切れています／手書きで不鮮明 など。問題なければ空文字）",
  "items": [
  { "brand": "銘柄名(特定名称含めて可)", "bottle_size": "1.8L" または "750ml",
    "cost_excl_tax": 1本あたりの仕入単価(税抜・整数/不明はnull), "qty": 数量(整数・既定1),
    "confidence": この明細を正しく読めた自信 0.0-1.0,
    "uncertain": ["自信が持てないフィールド名。brand/bottle_size/cost_excl_tax/qty から。確信があれば空配列"] }
] }
注意:
- 日本酒のみ。ビール・焼酎・サワー・送料・容器代などは含めない。
- quality は書類全体の判読しやすさ。暗い・ボケ・低解像度・見切れ・手書きが多い等なら "fair" か "low"。
- 容量は 1800ml/一升瓶/1.8L → "1.8L"、720ml/750ml/四合 → "750ml"。判別できなければ "1.8L" とし uncertain に "bottle_size" を入れる。
- cost_excl_tax は「1本あたりの仕入単価(税抜)」。小計・合計・消費税額を単価にしないこと。税抜が無く税込単価しか無ければその数値でよい。読み取れなければ null とし uncertain に "cost_excl_tax" を入れる。
- 読み取れた銘柄は漏れなく列挙。
- かすれ・手書き・潰れ等で確信が持てない値は、推測で埋めつつ confidence を下げ uncertain に該当フィールドを必ず入れる。誤りを自信ありげに出さない。`;

export async function recognizeInvoice(dataBase64: string, mediaType: string): Promise<InvoiceScanResult> {
  if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const client = new Anthropic();
  const isPdf = mediaType === "application/pdf";
  // 写真は image ブロック、PDF は document ブロックでそのまま渡す（Claudeが各ページを読む）
  const media = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: dataBase64 } }
    : {
        type: "image" as const,
        source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: dataBase64 },
      };
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system: INVOICE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [media, { type: "text", text: "この納品書/領収書の日本酒の明細を抽出し、指定JSONで返してください。" }],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AIの応答を解析できませんでした");
  const raw = JSON.parse(m[0]) as { supplier?: string; quality?: string; note?: string; items?: Partial<InvoiceItem>[] };
  const FIELDS = ["brand", "bottle_size", "cost_excl_tax", "qty"];
  const items = (raw.items ?? [])
    .map((it) => ({
      brand: String(it.brand ?? "").slice(0, 60),
      bottle_size: /750|720|四合/.test(String(it.bottle_size ?? "")) ? "750ml" : "1.8L",
      cost_excl_tax: it.cost_excl_tax != null && !isNaN(Number(it.cost_excl_tax)) ? Math.round(Number(it.cost_excl_tax)) : null,
      qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      confidence: Math.max(0, Math.min(1, Number(it.confidence ?? 0.5))),
      uncertain: Array.isArray(it.uncertain) ? it.uncertain.map(String).filter((f) => FIELDS.includes(f)) : [],
    }))
    .filter((it) => it.brand);
  // 単価が読めていない明細は必ず「不確実」に（売価が出せないので確認が要る）
  for (const it of items) {
    if (it.cost_excl_tax == null && !it.uncertain.includes("cost_excl_tax")) it.uncertain.push("cost_excl_tax");
  }
  const quality = (["good", "fair", "low"].includes(String(raw.quality)) ? raw.quality : "good") as "good" | "fair" | "low";
  return { supplier: String(raw.supplier ?? "").slice(0, 60), items, quality, note: String(raw.note ?? "").slice(0, 160) };
}

function normalizeBbox(b: unknown): { x: number; y: number; w: number; h: number } {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  if (!b || typeof b !== "object") return full;
  const o = b as Record<string, unknown>;
  const c01 = (v: unknown) => Math.max(0, Math.min(1, Number(v)));
  let x = c01(o.x), y = c01(o.y), w = c01(o.w), h = c01(o.h);
  if (!(w > 0.02) || !(h > 0.02)) return full; // 無効・極小はフルに
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}
