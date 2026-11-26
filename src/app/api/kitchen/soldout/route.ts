import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";
import { aiAvailable } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { matchBottle } from "@/lib/bottle-match";
import {
  candidatesOf, decideMatch, kitchenAuthorized, listOnMenu, loadCandidates, markSoldout, recentKitchenSoldouts, restoreSoldout, toKitchenSake, type How,
} from "@/lib/kitchen-soldout";

// ============================================================================
// 厨房モニター（KM）から、日本酒を売り切れにする口（2026-11-27 オーナー指示）。
//   「KM でボトルの写真を撮って載せるだけで、酒コレの該当の日本酒を売り切れにしたい」
//
//   鍵: ?token=（MO・KM と共有している MO_KITCHEN_TOKEN。/api/order/consume と同じ）。設定が無ければ 503
//   KM（別のドメインのページ）のブラウザからじかに呼ぶので、CORS を許している（鍵が無ければ、何もできない）
//
//   GET                                   … いま売り切れでないお酒の一覧（一覧から選ぶ用）・KM から売り切れにしたお酒（元に戻す用）・AI が使えるか
//   POST { op: "photo", image, media_type, apply? }
//        写真（base64。KM の側で小さくしてある）を読み取って、在庫リストの中から同じお酒を選ぶ。
//          result: "applied" … はっきり 1 本に決まった → 売り切れにした（sake・logId つき。まちがいなら logId で元に戻せる）
//                  "choose"  … 迷う・同じ銘柄の種類ちがいがある → 候補（candidates）から、スタッフが選ぶ
//                  "already" … そのお酒は、もう売り切れ
//                  "none"    … 合うお酒が無い（read ＝読み取った文字）
//        apply: false を付けると、決まっても売り切れにせず、候補として返す（確かめるだけ）
//   POST { op: "soldout", sakeId, how? }  … そのお酒を売り切れにする（候補から選んだ・一覧から選んだ）
//   POST { op: "restore", logId }         … 元に戻す（まちがえた。売り切れにしてから 24 時間まで）
//
//   まちがった銘柄を、だまって売り切れにしない決まり（自動にする条件）は、lib/kitchen-soldout.ts の decideMatch。
//   写真は、どこにも残さない。記録（audit_logs）に残すのは、読み取った文字・候補の番号・確信度だけ。
// ============================================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

/** 写真の大きさの上限（base64 の文字数。KM は長辺 1280px の JPEG にして送るので、ふつうは 20〜50 万文字） */
const MAX_IMAGE_CHARS = 2_400_000;
const MEDIA = ["image/jpeg", "image/png", "image/webp"] as const;
type Media = (typeof MEDIA)[number];

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function guard(req: NextRequest): NextResponse | null {
  const auth = kitchenAuthorized(req);
  if (auth === null) return json({ ok: false, error: "unconfigured" }, 503);
  if (!auth) return json({ ok: false, error: "unauthorized" }, 401);
  return null;
}

export async function GET(req: NextRequest) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const [sakes, recent] = await Promise.all([listOnMenu(), recentKitchenSoldouts()]);
    return json({ ok: true, ai: aiAvailable(), sakes, recent });
  } catch (e) {
    return json({ ok: false, error: "db_error", message: String(e).slice(0, 150) }, 500);
  }
}

export async function POST(req: NextRequest) {
  const bad = guard(req);
  if (bad) return bad;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const op = String(b.op || "");
  try {
    if (op === "soldout") {
      const sakeId = Math.floor(Number(b.sakeId));
      if (!Number.isInteger(sakeId) || sakeId <= 0) return json({ ok: false, error: "no_sake" }, 400);
      const how: How = b.how === "candidate" ? "candidate" : "pick";
      const r = await markSoldout(sakeId, how);
      if (r.code === "not_found") return json({ ok: false, op, error: "not_found" }, 404);
      return json({ ok: true, op, result: r.code === "soldout" ? "applied" : "already", sake: r.sake, logId: r.code === "soldout" ? r.logId : 0 });
    }

    if (op === "restore") {
      const logId = Math.floor(Number(b.logId));
      if (!Number.isInteger(logId) || logId <= 0) return json({ ok: false, error: "no_log" }, 400);
      const r = await restoreSoldout(logId);
      if (r.code === "restored") return json({ ok: true, op, result: "restored", sake: r.sake });
      // already_restored = もう戻してある ／ changed = そのあとで状態が動いた（納品・残数の変更など。戻さない）／ too_old = 24 時間を過ぎた
      return json({ ok: false, op, error: r.code }, r.code === "not_found" ? 404 : 409);
    }

    if (op === "photo") {
      const media = String(b.media_type || "image/jpeg") as Media;
      if (!MEDIA.includes(media)) return json({ ok: false, op, error: "bad_image_type" }, 400);
      const image = String(b.image || "").replace(/^data:[^;,]+;base64,/, "");
      if (!image) return json({ ok: false, op, error: "no_image" }, 400);
      if (image.length > MAX_IMAGE_CHARS) return json({ ok: false, op, error: "image_too_large" }, 413);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return json({ ok: false, op, error: "bad_image" }, 400);
      if (!aiAvailable()) return json({ ok: false, op, error: "ai_unavailable" }, 503);
      // 連打・こわれた端末で、AI の費用がふくらまないように（10 分に 40 枚まで。ふつうの使い方では届かない）
      if (!rateLimit("kitchen-soldout-photo", 40, 10 * 60_000)) return json({ ok: false, op, error: "busy" }, 429);

      const rows = await loadCandidates();
      if (!rows.length) return json({ ok: true, op, result: "none", read: { brand: "", subName: "", brewery: "" }, candidates: [] });
      const m = await matchBottle(image, media, candidatesOf(rows));
      if (!m.ok) {
        await audit("kitchen.photo_failed", { error: m.error, detail: m.detail });
        return json({ ok: false, op, error: m.error }, m.error === "ai_timeout" ? 504 : m.error === "ai_unavailable" ? 503 : 502);
      }
      const byId = new Map(rows.map((r) => [Number(r.id), r]));
      const d = decideMatch(m.matches, rows);
      const top = m.matches.map((x) => ({ id: x.id, c: Math.round(x.confidence * 100) / 100 }));
      const done = async (result: string, extra: Record<string, unknown> = {}) => {
        await audit("kitchen.photo", { result, read: m.read, top, model: m.model, bottle: m.bottle, ...(extra.logId ? { logId: extra.logId } : {}) });
        return json({ ok: true, op, result, read: m.read, bottle: m.bottle, ...extra });
      };
      if (d.kind === "none") return done("none", { candidates: [] });
      if (d.kind === "already") return done("already", { sake: toKitchenSake(byId.get(d.id)!) });
      if (d.kind === "apply" && b.apply !== false) {
        const r = await markSoldout(d.id, "photo", { read: m.read, confidence: d.confidence, model: m.model });
        if (r.code === "soldout") return done("applied", { sake: r.sake, logId: r.logId });
        if (r.code === "already") return done("already", { sake: r.sake });
        return done("none", { candidates: [] }); // この一瞬に、削除された
      }
      const ids = d.kind === "apply" ? [d.id] : d.ids;
      return done("choose", { why: d.kind === "choose" ? d.why : "confirm", candidates: ids.map((id) => toKitchenSake(byId.get(id)!)) });
    }

    return json({ ok: false, error: "bad_op" }, 400);
  } catch (e) {
    return json({ ok: false, op, error: "db_error", message: String(e).slice(0, 150) }, 500);
  }
}
