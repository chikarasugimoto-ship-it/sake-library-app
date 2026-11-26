import Anthropic from "@anthropic-ai/sdk";
import { aiAvailable } from "./ai";

// ============================================================================
// ボトルの写真から、店の在庫リストの中の「同じ日本酒」を選ぶ（2026-11-27 オーナー指示）。
//   厨房モニター（KM）で空いたボトルを撮ると、酒コレで売り切れになる機能（/api/kitchen/soldout）の、読み取りの部分。
//
// ラベルを読む ai.ts の recognizeLabel とのちがい:
//   あちらは「何のお酒か」を自由に答える（新しい銘柄の登録用）。こちらは、**在庫リストの中から選ぶだけ**。
//   リストに無い id は、返ってきても捨てる（呼ぶ側の decideMatch）。
//
// 決めごと:
//   - 返すのは「読み取った文字」と「候補（id と確信度）」だけ。売り切れにするかどうかは、ここでは決めない
//   - スタッフが iPad の前で待っているので、20 秒で打ち切る（やり直しは 1 回まで）。だめなら、KM は一覧から選ぶ道を出す
//   - まず MATCH_MODEL に、決まった形（JSON スキーマ）で答えさせる。安全の仕組みで断られたときは、API の側で
//     MATCH_MODEL_PLAIN に回してもらう（fallbacks）。この形そのものを API が受けつけないとき（モデルを使えない、など）は、
//     ラベル読み取り（ai.ts）と同じ、前からの形で、もう一度だけ聞く
//   - 写真は、どこにも残さない（API に送るだけ）
// ============================================================================

export const MATCH_MODEL = "claude-opus-5-5";
export const MATCH_MODEL_PLAIN = "claude-opus-4-8";
const MATCH_TIMEOUT_MS = 20_000;

export type MatchCandidate = {
  id: number;
  brand: string;
  subName: string;
  brewery: string;
  prefecture: string;
  grade: string;
  seasonLabel: string;
  bottleSize: string;
};
export type MatchOk = {
  ok: true;
  /** 日本酒の瓶が写っていたか */
  bottle: boolean;
  /** ラベルから読み取った文字（合うものが無かったときに、スタッフに見せる） */
  read: { brand: string; subName: string; brewery: string };
  /** 候補（確信度の高い順）。id がリストにあるかは、呼ぶ側で確かめる */
  matches: { id: number; confidence: number }[];
  model: string;
};
export type MatchErr = { ok: false; error: "ai_unavailable" | "ai_refused" | "ai_timeout" | "ai_error"; detail: string };
export type MatchResult = MatchOk | MatchErr;

const SYSTEM = `あなたは、日本酒のラベルを読み取って、店の「在庫リスト」の中から同じお酒を選ぶ係です。

やること:
1. 写真に写っている日本酒の瓶のラベルから、銘柄・種類（特定名称、酒米、「生」「無濾過」「ひやおろし」などの表記）・蔵元を読み取る。
2. 在庫リストの中から、同じお酒を選ぶ。リストに無いお酒は、選ばない（似ているだけのものを、無理に選ばない）。

確信度（confidence）の付け方:
- 0.9 以上: ラベルの銘柄と種類の両方が、リストの 1 件と、はっきり合う。
- 0.7 以下: 銘柄しか読めない、ピントが合っていない、同じ銘柄で種類ちがいの可能性がある。
- リストに同じ銘柄のお酒が複数あって、ラベルからどれか決められないときは、ありうるものを全部返す（それぞれ 0.6 以下）。

次のときは、matches を空にする: 日本酒の瓶が写っていない、ラベルが読めない、リストに合うお酒が無い。

答えは、次の形の JSON だけ（説明や前置きは書かない）:
{"bottle": 日本酒の瓶が写っているか（true/false）, "read": {"brand": "読み取った銘柄", "sub_name": "読み取った種類・補足", "brewery": "読み取った蔵元"}, "matches": [{"id": リストの id, "confidence": 0〜1}]}
matches は、確信度の高い順に、多くても 3 件。読み取れなかった項目は、空の文字にする。`;

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bottle", "read", "matches"],
  properties: {
    bottle: { type: "boolean" },
    read: {
      type: "object",
      additionalProperties: false,
      required: ["brand", "sub_name", "brewery"],
      properties: { brand: { type: "string" }, sub_name: { type: "string" }, brewery: { type: "string" } },
    },
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "confidence"],
        properties: { id: { type: "integer" }, confidence: { type: "number" } },
      },
    },
  },
};

const cell = (v: string, max: number) => String(v ?? "").replace(/[|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/**
 * 在庫リストを、モデルに渡す文にする。id の順に並べ、時刻や状態（売り切れかどうか）を入れない
 * ＝続けて何本か撮るあいだ、文が 1 文字も変わらない（API の側で、同じ文の読みこみが安くなる）。
 */
export function candidateListText(list: MatchCandidate[]): string {
  const rows = [...list]
    .sort((a, b) => a.id - b.id)
    .map((c) => [c.id, cell(c.brand, 60), cell(c.subName, 60), cell(c.grade, 20), cell(c.brewery, 60), cell(c.prefecture, 10), cell(c.seasonLabel, 20), cell(c.bottleSize, 8)].join(" | "));
  return `在庫リスト（${rows.length} 件）\nid | 銘柄 | 補足 | 特定名称 | 蔵元 | 都道府県 | 季節 | 容量\n${rows.join("\n")}`;
}

type RawAnswer = { bottle?: unknown; read?: { brand?: unknown; sub_name?: unknown; brewery?: unknown }; matches?: unknown };
/** モデルの答え（文字）を、決まった形にする。JSON として読めなければ null */
export function parseMatchText(text: string): Omit<MatchOk, "ok" | "model"> | null {
  let raw: RawAnswer | null = null;
  try { raw = JSON.parse(text) as RawAnswer; } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { raw = JSON.parse(m[0]) as RawAnswer; } catch { raw = null; } }
  }
  if (!raw || typeof raw !== "object") return null;
  const matches: { id: number; confidence: number }[] = [];
  for (const x of Array.isArray(raw.matches) ? raw.matches.slice(0, 10) : []) {
    if (typeof x !== "object" || x === null) continue;
    const id = Number((x as { id?: unknown }).id);
    const confidence = Number((x as { confidence?: unknown }).confidence);
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(confidence)) continue;
    if (matches.some((m) => m.id === id)) continue;
    matches.push({ id, confidence: Math.max(0, Math.min(1, confidence)) });
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  return {
    bottle: raw.bottle !== false,
    read: { brand: String(raw.read?.brand ?? "").slice(0, 60), subName: String(raw.read?.sub_name ?? "").slice(0, 60), brewery: String(raw.read?.brewery ?? "").slice(0, 60) },
    matches: matches.slice(0, 3),
  };
}

type Media = "image/jpeg" | "image/png" | "image/webp";
const textOf = (content: { type: string }[]) => content.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("");
const short = (e: unknown) => String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 150);

export async function matchBottle(imageBase64: string, mediaType: Media, list: MatchCandidate[]): Promise<MatchResult> {
  if (!aiAvailable()) return { ok: false, error: "ai_unavailable", detail: "" };
  const client = new Anthropic();
  const listText = candidateListText(list);
  const userContent = [
    { type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data: imageBase64 } },
    { type: "text" as const, text: "この写真の日本酒を、在庫リストから選んでください。" },
  ];
  const opts = { timeout: MATCH_TIMEOUT_MS, maxRetries: 1 };

  const finish = (stop: string | null, content: { type: string }[], model: string): MatchResult => {
    // 安全の仕組みで断られたとき（HTTP は 200）。中身を読む前に見る
    if (stop === "refusal") return { ok: false, error: "ai_refused", detail: "" };
    const parsed = parseMatchText(textOf(content));
    if (!parsed) return { ok: false, error: "ai_error", detail: `答えを読めなかった（${stop ?? ""}）` };
    return { ok: true, ...parsed, model };
  };

  try {
    const res = await client.beta.messages.create(
      {
        model: MATCH_MODEL,
        max_tokens: 8000,
        // 断られたとき（refusal）は、API の側で、前の世代のモデルに回してもらう
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: [{ model: MATCH_MODEL_PLAIN }],
        // 急ぐ仕事なので、考える深さは「低」。答えは、決まった形の JSON
        output_config: { effort: "low", format: { type: "json_schema", schema: MATCH_SCHEMA } },
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: listText, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userContent }],
      },
      opts
    );
    return finish(res.stop_reason, res.content, res.model);
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "ai_timeout", detail: "" };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "ai_unavailable", detail: "鍵が通らない" };
    const shapeRejected = e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.PermissionDeniedError;
    if (!shapeRejected) {
      if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "ai_error", detail: "混んでいる（429）" };
      if (e instanceof Anthropic.APIError) return { ok: false, error: "ai_error", detail: `API ${e.status ?? ""} ${short(e)}` };
      return { ok: false, error: "ai_error", detail: short(e) };
    }
    // この形を API が受けつけなかった（モデルを使えない・新しい指定を知らない、など）→ ラベル読み取りと同じ、前からの形で、もう一度だけ
    try {
      const res = await client.messages.create(
        { model: MATCH_MODEL_PLAIN, max_tokens: 1500, system: `${SYSTEM}\n\n${listText}`, messages: [{ role: "user", content: userContent }] },
        opts
      );
      return finish(res.stop_reason, res.content, res.model);
    } catch (e2) {
      if (e2 instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "ai_timeout", detail: "" };
      if (e2 instanceof Anthropic.APIError) return { ok: false, error: "ai_error", detail: `API ${e2.status ?? ""} ${short(e2)}（はじめ: ${short(e)}）` };
      return { ok: false, error: "ai_error", detail: short(e2) };
    }
  }
}
