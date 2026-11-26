import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, audit } from "./db";
import { recordSoldoutEvent } from "./notify";
import { photoUrl } from "./types";
import type { MatchCandidate } from "./bottle-match";

// ============================================================================
// 厨房モニター（KM）から、日本酒を売り切れにする（2026-11-27 オーナー指示）。
//   「KM でボトルの写真を撮って載せるだけで、酒コレの該当の日本酒を売り切れにしたい。酒コレのアプリで操作するのは手間」
//
// 口は /api/kitchen/soldout。ここは、その中身（鍵・在庫リスト・売り切れにする・元に戻す・写真の読み取りの結果から決める）。
//
// 決めごと:
//   - やることは、在庫ボードの「売切」ボタン（/api/admin/sakes/[id] の status: "soldout"）と同じ:
//     状態を売り切れに・売切日を入れる（空のときだけ）・開栓日を消す・売切イベントを記録（夜の日報が拾う。LINE は送らない）。
//     残数（stock_count）には、さわらない（在庫ボードのボタンも、さわらない）
//   - **まちがった銘柄を、だまって売り切れにしない**:
//       写真から自動で売り切れにするのは、読み取りが「この 1 本」とはっきり言っていて（確信度 SURE 以上・次点が NEXT_MAX 以下）、
//       しかも、同じ銘柄の種類ちがいが、いまメニューに無いときだけ。それ以外は、候補を返して、スタッフに 1 回押してもらう
//   - **元に戻せる**: 売り切れにするときに、前の状態（提供中／残りわずか）と開栓日を控えておく（kitchen_soldout）。
//     「元に戻す」は、その控えのとおりに戻す。そのあとで納品・残数の変更などで状態が動いていたら、戻さない（売切日が変わっているかで見る）
//   - 鍵は、MO・KM と共有している MO_KITCHEN_TOKEN（か SAKE_BRIDGE_SECRET）。/api/order/consume と同じ
// ============================================================================

/** 確信度が、これ以上なら「この 1 本」とみなす */
export const SURE = 0.9;
/** 次点の確信度が、これ以下であること（これより高い次点がいたら、迷っている） */
export const NEXT_MAX = 0.5;
/** 売り切れにしてから、この時間までは「元に戻す」ができる */
export const UNDO_HOURS = 24;
/** 読み取りの候補に入れる、売り切れずみのお酒（何日前までのものか）。「もう売り切れです」と答えるため */
const SOLDOUT_KEEP_DAYS = 3;

/** 鍵が合えば true・合わなければ false・鍵が 1 つも設定されていなければ null（＝この口は閉じている） */
export function kitchenAuthorized(req: NextRequest): boolean | null {
  const accepted = [process.env.MO_KITCHEN_TOKEN, process.env.SAKE_BRIDGE_SECRET].filter((v): v is string => !!v);
  if (!accepted.length) return null;
  const token = req.nextUrl.searchParams.get("token") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || "";
  if (!token) return false;
  const a = Buffer.from(token, "utf8");
  return accepted.some((v) => { const b = Buffer.from(v, "utf8"); return a.length === b.length && timingSafeEqual(a, b); });
}

type Row = {
  id: number; brand: string; sub_name: string; brewery: string; prefecture: string; grade: string; season_label: string; bottle_size: string;
  status: string; stock_count: number | null; has_photo: number; updated_at: string; label_color: string;
};
/** 読む列（p = 表の別名の頭。結合で使うときは "s."） */
const cols = (p = "") => `${p}id AS id, ${p}brand AS brand, COALESCE(${p}sub_name,'') AS sub_name, COALESCE(${p}brewery,'') AS brewery, COALESCE(${p}prefecture,'') AS prefecture,
  COALESCE(${p}grade,'') AS grade, COALESCE(${p}season_label,'') AS season_label, COALESCE(${p}bottle_size,'') AS bottle_size, ${p}status AS status, ${p}stock_count AS stock_count,
  (${p}photo IS NOT NULL OR COALESCE(${p}photo_url,'') != '') AS has_photo, COALESCE(${p}updated_at,'') AS updated_at, COALESCE(${p}label_color,'') AS label_color`;
const COLS = cols();

/** KM に見せる形（写真は、酒コレの /api/photo/<id> への道。KM が酒コレの URL を頭に付ける） */
export type KitchenSake = { id: number; brand: string; subName: string; brewery: string; prefecture: string; grade: string; status: string; stockCount: number | null; photo: string; labelColor: string };
export const toKitchenSake = (r: Row): KitchenSake => ({
  id: Number(r.id), brand: String(r.brand || ""), subName: r.sub_name, brewery: r.brewery, prefecture: r.prefecture, grade: r.grade, status: String(r.status || ""),
  stockCount: r.stock_count == null ? null : Number(r.stock_count), photo: Number(r.has_photo) ? photoUrl(Number(r.id), r.updated_at) : "", labelColor: r.label_color,
});
const toCandidate = (r: Row): MatchCandidate => ({ id: Number(r.id), brand: String(r.brand || ""), subName: r.sub_name, brewery: r.brewery, prefecture: r.prefecture, grade: r.grade, seasonLabel: r.season_label, bottleSize: r.bottle_size });

/**
 * 読み取りの候補（在庫リスト）。削除していないお酒のうち、売り切れでないもの＋ここ数日で売り切れになったもの。
 * 何か月も前に売り切れたままの行は入れない（リストが長くなるほど、読み取りが遅く・あいまいになる）
 */
export async function loadCandidates(): Promise<Row[]> {
  return all<Row>(
    `SELECT ${COLS} FROM sakes
      WHERE archived = 0 AND (status != 'soldout' OR soldout_at >= datetime('now','localtime','-${SOLDOUT_KEEP_DAYS} days'))
      ORDER BY id LIMIT 300`
  );
}
export const candidatesOf = (rows: Row[]): MatchCandidate[] => rows.map(toCandidate);

/** 一覧から選ぶ用: いま売り切れでないお酒（メニューと同じ並び） */
export async function listOnMenu(): Promise<KitchenSake[]> {
  return (await all<Row>(`SELECT ${COLS} FROM sakes WHERE archived = 0 AND status != 'soldout' ORDER BY sort_order, id LIMIT 300`)).map(toKitchenSake);
}

export type RecentSoldout = { logId: number; how: string; at: string; sake: KitchenSake };
/** KM から売り切れにして、まだ売り切れのままのお酒（「元に戻す」ができるもの。新しい順） */
export async function recentKitchenSoldouts(): Promise<RecentSoldout[]> {
  const rows = await all<Row & { log_id: number; how: string; at: string }>(
    `SELECT k.id AS log_id, k.how AS how, k.created_at AS at, ${cols("s.")}
       FROM kitchen_soldout k JOIN sakes s ON s.id = k.sake_id
      WHERE k.created_at >= datetime('now','localtime','-${UNDO_HOURS} hours') AND k.undone_at = ''
        AND s.archived = 0 AND s.status = 'soldout' AND COALESCE(s.soldout_at,'') = k.sold_at
        AND k.id = (SELECT MAX(k2.id) FROM kitchen_soldout k2 WHERE k2.sake_id = k.sake_id)
      ORDER BY k.id DESC LIMIT 30`
  );
  return rows.map((r) => ({ logId: Number(r.log_id), how: String(r.how || ""), at: String(r.at || ""), sake: toKitchenSake(r) }));
}

export type How = "photo" | "candidate" | "pick";
export type MarkResult = { code: "soldout"; logId: number; sake: KitchenSake } | { code: "already"; sake: KitchenSake } | { code: "not_found" };
/**
 * 売り切れにする。在庫ボードの「売切」と同じことをして、「元に戻す」のための控えを残す。
 * もう売り切れのお酒には、何もしない（already）。2 台の iPad が同時に押しても、売り切れにするのは 1 回（控えも 1 行）
 */
export async function markSoldout(sakeId: number, how: How, detail: unknown = ""): Promise<MarkResult> {
  const before = await get<Row & { opened_at: string }>(`SELECT ${COLS}, COALESCE(opened_at,'') AS opened_at FROM sakes WHERE id = ? AND archived = 0`, [sakeId]);
  if (!before) return { code: "not_found" };
  if (before.status === "soldout") return { code: "already", sake: toKitchenSake(before) };
  const upd = await run(
    `UPDATE sakes SET status = 'soldout', opened_at = '',
            soldout_at = CASE WHEN soldout_at IS NULL OR soldout_at = '' THEN datetime('now','localtime') ELSE soldout_at END,
            updated_at = datetime('now','localtime')
      WHERE id = ? AND archived = 0 AND status != 'soldout'`,
    [sakeId]
  );
  const after = await get<Row & { soldout_at: string }>(`SELECT ${COLS}, COALESCE(soldout_at,'') AS soldout_at FROM sakes WHERE id = ?`, [sakeId]);
  if (!after) return { code: "not_found" };
  if (upd.rowsAffected < 1) return { code: "already", sake: toKitchenSake(after) }; // この一瞬に、ほかの端末・注文が売り切れにした
  const prevStatus = before.status === "low" ? "low" : "available";
  const ins = await run("INSERT INTO kitchen_soldout (sake_id, how, prev_status, prev_opened_at, sold_at, detail) VALUES (?, ?, ?, ?, ?, ?)", [
    sakeId, how, prevStatus, before.opened_at, after.soldout_at, (typeof detail === "string" ? detail : JSON.stringify(detail ?? "")).slice(0, 500),
  ]);
  await audit("sake.status", { id: sakeId, status: "soldout", by: "km", how });
  await recordSoldoutEvent(sakeId); // 夜の日報が拾う（LINE は送らない）
  revalidatePath("/");
  revalidatePath(`/sake/${sakeId}`);
  return { code: "soldout", logId: Number(ins.lastInsertRowid) || 0, sake: toKitchenSake(after) };
}

export type RestoreResult = { code: "restored"; sake: KitchenSake } | { code: "not_found" | "already_restored" | "too_old" | "changed" };
/**
 * 「元に戻す」（まちがえた）。控えのとおりに、前の状態・開栓日へ戻す。
 * 戻すのは、その控えが、そのお酒のいちばん新しい控えで、売り切れにしたときから状態が動いていないときだけ
 * （売切日が同じ＝そのあとで納品・残数の変更・在庫ボードの操作が入っていない）。動いていたら changed（何もしない）
 */
export async function restoreSoldout(logId: number): Promise<RestoreResult> {
  const log = await get<{ id: number; sake_id: number; prev_status: string; prev_opened_at: string; sold_at: string; undone_at: string; fresh: number }>(
    `SELECT id, sake_id, prev_status, prev_opened_at, sold_at, undone_at, (created_at >= datetime('now','localtime','-${UNDO_HOURS} hours')) AS fresh FROM kitchen_soldout WHERE id = ?`,
    [logId]
  );
  if (!log) return { code: "not_found" };
  if (log.undone_at) return { code: "already_restored" };
  if (!Number(log.fresh)) return { code: "too_old" };
  const latest = await get<{ id: number }>("SELECT MAX(id) AS id FROM kitchen_soldout WHERE sake_id = ?", [log.sake_id]);
  if (Number(latest?.id) !== Number(log.id)) return { code: "changed" };
  const prev = log.prev_status === "low" ? "low" : "available";
  const upd = await run(
    `UPDATE sakes SET status = ?, soldout_at = '', opened_at = ?, updated_at = datetime('now','localtime')
      WHERE id = ? AND archived = 0 AND status = 'soldout' AND COALESCE(soldout_at,'') = ? AND (stock_count IS NULL OR stock_count > 0)`,
    [prev, log.prev_opened_at, log.sake_id, log.sold_at]
  );
  if (upd.rowsAffected < 1) {
    // 2 台が同時に「元に戻す」を押した片方（もう片方が、いま戻した）なら「もう戻してある」。そうでなければ、状態が動いている
    const now = await get<{ undone_at: string }>("SELECT undone_at FROM kitchen_soldout WHERE id = ?", [log.id]);
    return { code: now?.undone_at ? "already_restored" : "changed" };
  }
  await run("UPDATE kitchen_soldout SET undone_at = datetime('now','localtime') WHERE id = ? AND undone_at = ''", [log.id]);
  await audit("sake.status", { id: log.sake_id, status: prev, by: "km", undo: true });
  // 夜の日報が、この売り切れを「完売」として報告しないように（lib/brief.ts の todaysSoldouts が見る）
  await audit("sake.soldout_undone", { id: log.sake_id, logId: log.id });
  revalidatePath("/");
  revalidatePath(`/sake/${log.sake_id}`);
  const row = await get<Row>(`SELECT ${COLS} FROM sakes WHERE id = ?`, [log.sake_id]);
  return row ? { code: "restored", sake: toKitchenSake(row) } : { code: "not_found" };
}

const brandKey = (s: string) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
/** 同じ銘柄か。銘柄の欄に種類まで書いてある登録（「風の森」と「風の森 ALPHA 1」）も、同じ銘柄として扱う（頭が同じ・2 文字以上） */
const sameBrand = (a: string, b: string) => {
  const x = brandKey(a), y = brandKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.startsWith(short);
};
export type Decision =
  | { kind: "none" }
  | { kind: "apply"; id: number; confidence: number }
  | { kind: "already"; id: number }
  | { kind: "choose"; ids: number[]; why: "unsure" | "sibling" };
/**
 * 読み取りの結果から、どうするかを決める（DB にも AI にも触れない。テストしやすいように、ここだけ切り出してある）。
 *   none    … 合うお酒が無い
 *   apply   … この 1 本、と言える → 売り切れにしてよい
 *   already … この 1 本、と言えるが、もう売り切れ
 *   choose  … 迷う（確信度が足りない・次点がいる）／同じ銘柄の種類ちがいが、いまメニューにある → スタッフに選んでもらう
 * リストに無い id は、捨てる（モデルが、リストに無い番号を返しても、そのお酒には触れない）
 */
export function decideMatch(matches: { id: number; confidence: number }[], rows: Pick<Row, "id" | "brand" | "status">[]): Decision {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const seen = new Set<number>();
  const valid = matches
    .filter((m) => Number.isInteger(m.id) && byId.has(m.id) && Number.isFinite(m.confidence) && !seen.has(m.id) && !!seen.add(m.id))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
  if (!valid.length) return { kind: "none" };
  const top = valid[0];
  const topRow = byId.get(top.id)!;
  const clear = top.confidence >= SURE && (valid.length === 1 || valid[1].confidence <= NEXT_MAX);
  // 同じ銘柄の、種類ちがい（いま売り切れでないもの）
  const siblings = rows.filter((r) => Number(r.id) !== top.id && r.status !== "soldout" && sameBrand(r.brand, topRow.brand)).map((r) => Number(r.id));
  if (clear && topRow.status === "soldout") return siblings.length ? { kind: "choose", ids: [top.id, ...siblings].slice(0, 6), why: "sibling" } : { kind: "already", id: top.id };
  if (clear && !siblings.length) return { kind: "apply", id: top.id, confidence: top.confidence };
  const ids = [...valid.map((m) => m.id)];
  for (const s of siblings) if (!ids.includes(s)) ids.push(s);
  return { kind: "choose", ids: ids.slice(0, 6), why: clear ? "sibling" : "unsure" };
}
