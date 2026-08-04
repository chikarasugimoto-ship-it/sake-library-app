// 隠し酒プレゼント（景表法=総付景品）の「実体」。種類数の節目に達したら一意の引換コードを
// サーバー権威で発行し（reward_grants）、店頭でスタッフが1タップで消し込む。抽選・確率は一切なし＝
// 達成すれば誰でも無条件にもらえる（賭博性ゼロ）。提供は90ml・お会計の2割以内に収める運用。
import { all, get, run } from "./db";

export type OwnerKind = "member" | "guest";

// 隠し酒プレゼントの節目（集めた種類数）。初回10種で早い達成感→以降50刻み。
export const REWARD_MILESTONES_SERVER = [10, 50, 100, 150, 200];

// 人が口頭で言える短いコード（例 SK-AB12-CD34）。Math.random/crypto いずれでも可。
function genCode(): string {
  let hex = "";
  try {
    hex = (globalThis.crypto?.randomUUID?.() || "").replace(/[^a-f0-9]/gi, "");
  } catch {
    hex = "";
  }
  if (hex.length < 8) hex = (hex + Math.random().toString(16).slice(2)).padEnd(8, "0");
  const a = hex.slice(0, 4).toUpperCase();
  const b = hex.slice(4, 8).toUpperCase();
  return `SK-${a}-${b}`;
}

// 種類数の節目に達していて未発行のものを発行（冪等＝二重発行しない）。
export async function issueRewards(ownerKind: OwnerKind, ownerId: string, kinds: number): Promise<void> {
  if (!ownerId) return;
  for (const m of REWARD_MILESTONES_SERVER) {
    if (kinds < m) break;
    try {
      await run(
        `INSERT OR IGNORE INTO reward_grants (store_id, owner_kind, owner_id, reason, code, cap_yen, status)
         VALUES (1, ?, ?, ?, ?, 0, 'issued')`,
        [ownerKind, ownerId, `milestone:${m}`, genCode()]
      );
    } catch {
      // UNIQUE(owner_kind,owner_id,reason) 既存などは無視
    }
  }
}

export type RewardRow = {
  id: number;
  reason: string;
  code: string;
  status: string; // issued | redeemed | void
  issued_at: string;
  redeemed_at: string;
  sake_id: number; // お客様が迎えた隠し酒（0=まだ選んでいない）
  sake_brand: string; // 迎えた隠し酒の銘柄名（表示用・未選択は空）
  god_name: string; // その酒神の名前（表示用）
};

// 本人の引換コード一覧（新しい順）。sake_id があれば迎えた隠し酒の銘柄/酒神名も同梱。
export async function listRewards(ownerKind: OwnerKind, ownerId: string): Promise<RewardRow[]> {
  if (!ownerId) return [];
  return all<RewardRow>(
    `SELECT rg.id, rg.reason, rg.code, rg.status, rg.issued_at, rg.redeemed_at, rg.sake_id,
            COALESCE(s.brand, '') AS sake_brand, COALESCE(g.name, '') AS god_name
       FROM reward_grants rg
       LEFT JOIN sakes s ON s.id = rg.sake_id
       LEFT JOIN gods g ON g.sake_id = rg.sake_id
      WHERE rg.owner_kind = ? AND rg.owner_id = ?
      ORDER BY rg.id DESC`,
    [ownerKind, ownerId]
  );
}

// お客様が引換で選べる「隠し酒」の一覧（提供中＝archived=0・売切でない）。
// 「未収集のみ」の絞り込みは図鑑の保有状況を知るクライアント側で行う。
export type HiddenGod = {
  sakeId: number;
  brand: string;
  godName: string;
  rarity: string;
  hasArt: boolean;
  godUpdated: string;
};
export async function listHiddenGods(): Promise<HiddenGod[]> {
  const rows = await all<{
    id: number;
    brand: string;
    god_name: string | null;
    god_rarity: string | null;
    god_has_art: number | null;
    god_updated: string | null;
  }>(
    `SELECT s.id, s.brand, g.name AS god_name, g.rarity AS god_rarity,
            (g.god_art IS NOT NULL OR g.god_art_url <> '') AS god_has_art, g.updated_at AS god_updated
       FROM sakes s
       LEFT JOIN gods g ON g.sake_id = s.id
      WHERE s.archived = 0 AND s.is_hidden = 1 AND s.status <> 'soldout'
      ORDER BY s.sort_order, s.id`
  );
  return rows.map((r) => ({
    sakeId: r.id,
    brand: r.brand,
    godName: r.god_name || r.brand,
    rarity: r.god_rarity || "LR", // 隠し酒は基本レジェンド級。メタ未生成でも見栄えを担保
    hasArt: !!r.god_has_art,
    godUpdated: r.god_updated || "",
  }));
}

export type ClaimResult =
  | { ok: true; god: HiddenGod }
  | { ok: false; error: "not_found" | "already_claimed" | "not_eligible" | "already_owned" };

// 客側の引換＝本人のマイルストーン特典で「隠し酒を1つ選んで」その酒神を図鑑に迎える。
// 本人確認（owner一致）→未引換(sake_id=0)→提供中の隠し酒→未収集 を検証し、
// grant に sake_id を確定（同時実行は sake_id=0 条件付きUPDATE＋再読込で二重取得を防ぐ）→ markTasted →演出データを返す。
export async function claimGod(
  ownerKind: OwnerKind,
  ownerId: string,
  grantId: number,
  sakeId: number,
  date: string
): Promise<ClaimResult> {
  if (!ownerId || !grantId || !sakeId) return { ok: false, error: "not_found" };
  // 1. grant 本人確認＆未引換（まだ酒神を選んでいない）
  const grant = await get<{ id: number; sake_id: number }>(
    "SELECT id, sake_id FROM reward_grants WHERE id = ? AND owner_kind = ? AND owner_id = ?",
    [grantId, ownerKind, ownerId]
  );
  if (!grant) return { ok: false, error: "not_found" };
  if (Number(grant.sake_id) > 0) return { ok: false, error: "already_claimed" };
  // 2. 対象が「提供中の隠し酒」か（在庫あり＝archived=0・売切でない・is_hidden）
  const sake = await get<{ id: number; status: string }>(
    "SELECT id, status FROM sakes WHERE id = ? AND is_hidden = 1 AND archived = 0",
    [sakeId]
  );
  if (!sake || sake.status === "soldout") return { ok: false, error: "not_eligible" };
  // 3. 既に図鑑にあるなら無駄打ち防止（未収集のみ）
  const tastedTable = ownerKind === "member" ? "member_tasted" : "guest_tasted";
  const tastedCol = ownerKind === "member" ? "line_user_id" : "guest_id";
  const owned = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${tastedTable} WHERE ${tastedCol} = ? AND sake_id = ?`,
    [ownerId, sakeId]
  );
  if (Number(owned?.n) > 0) return { ok: false, error: "already_owned" };
  // 4. grant に sake_id を確定（sake_id=0 のときだけ＝同時引換でこの1件を勝者にする）→再読込で勝者か確認
  await run("UPDATE reward_grants SET sake_id = ? WHERE id = ? AND sake_id = 0", [sakeId, grantId]);
  const after = await get<{ sake_id: number }>("SELECT sake_id FROM reward_grants WHERE id = ?", [grantId]);
  if (Number(after?.sake_id) !== sakeId) return { ok: false, error: "already_claimed" };
  // 5. 図鑑に迎える（冪等）
  await run(
    `INSERT INTO ${tastedTable} (${tastedCol}, sake_id, tasted_date, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(${tastedCol}, sake_id) DO NOTHING`,
    [ownerId, sakeId, date || ""]
  );
  // 6. 演出に渡す酒神データ
  const god = await get<{ name: string; rarity: string; has_art: number; updated_at: string }>(
    "SELECT name, rarity, (god_art IS NOT NULL OR god_art_url <> '') AS has_art, updated_at FROM gods WHERE sake_id = ?",
    [sakeId]
  );
  const brand = (await get<{ brand: string }>("SELECT brand FROM sakes WHERE id = ?", [sakeId]))?.brand || "";
  return {
    ok: true,
    god: {
      sakeId,
      brand,
      godName: god?.name || brand,
      rarity: god?.rarity || "LR",
      hasArt: !!god?.has_art,
      godUpdated: god?.updated_at || "",
    },
  };
}

export type RedeemResult = "ok" | "not_found" | "already";

// 店頭でコードを消し込む（スタッフ操作）。発行済みのみ消し込み可。
export async function redeemReward(code: string, staff: string): Promise<RedeemResult> {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return "not_found";
  const row = await get<{ id: number; status: string }>("SELECT id, status FROM reward_grants WHERE code = ?", [c]);
  if (!row) return "not_found";
  if (row.status === "redeemed") return "already";
  await run("UPDATE reward_grants SET status = 'redeemed', redeemed_at = datetime('now','localtime'), redeemed_by = ? WHERE id = ?", [
    String(staff || "").slice(0, 40),
    row.id,
  ]);
  return "ok";
}

// 節目(種類数)→人に見せるラベル
export function rewardLabel(reason: string): string {
  const m = /^milestone:(\d+)$/.exec(reason);
  return m ? `${m[1]}種 達成` : "達成特典";
}
