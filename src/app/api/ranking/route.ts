import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { all, get, run } from "@/lib/db";
import { verifySession, MEMBER_COOKIE } from "@/lib/line";
import { readGuest } from "@/lib/guest";

// 図鑑ランキング：集めた「種類数」順（飲み過ぎ競争を煽らない）。
// LINE会員（member_tasted）＋匿名ゲスト（guest_tasted）の両方が参加。誰でも閲覧可。
// 参加者が増えても重くならないよう、全件集計は60秒ごとに1回だけ行いキャッシュ（ranking_cache）。
// 各リクエストはキャッシュを読み、上位10名＋本人の順位だけを返す。

type Row = { kind: "m" | "g"; id: string; name: string; picture: string; kinds: number; avatar: number };
const TTL_MS = 60_000; // 集計の有効期限（ランキングは60秒の遅延を許容）

// 全件集計（重い）。キャッシュが切れた時だけ実行。
async function computeRows(): Promise<Row[]> {
  const members = await all<{ line_user_id: string; name: string; picture_url: string; kinds: number; ts: string; avatar_sake_id: number }>(
    `SELECT m.line_user_id,
            COALESCE(NULLIF(m.nickname, ''), m.display_name) AS name,
            m.picture_url,
            m.avatar_sake_id,
            COUNT(t.sake_id) AS kinds,
            MAX(t.created_at) AS ts
     FROM members m
     JOIN member_tasted t ON t.line_user_id = m.line_user_id
     GROUP BY m.line_user_id
     HAVING kinds > 0`
  );
  const guests = await all<{ guest_id: string; name: string; kinds: number; ts: string; avatar_sake_id: number }>(
    `SELECT gt.guest_id,
            COALESCE(g.name, '') AS name,
            g.avatar_sake_id AS avatar_sake_id,
            COUNT(gt.sake_id) AS kinds,
            MAX(gt.created_at) AS ts
     FROM guest_tasted gt
     LEFT JOIN guests g ON g.guest_id = gt.guest_id
     GROUP BY gt.guest_id
     HAVING COUNT(gt.sake_id) > 0`
  );
  type WithTs = Row & { ts: string };
  const rows: WithTs[] = [
    ...members.map((m) => ({ kind: "m" as const, id: m.line_user_id, name: m.name || "ゲスト", picture: m.picture_url || "", kinds: Number(m.kinds), ts: m.ts || "", avatar: Number(m.avatar_sake_id) || 0 })),
    ...guests.map((g) => ({ kind: "g" as const, id: g.guest_id, name: g.name || "ゲスト", picture: "", kinds: Number(g.kinds), ts: g.ts || "", avatar: Number(g.avatar_sake_id) || 0 })),
  ];
  rows.sort((a, b) => b.kinds - a.kinds || (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return rows.map(({ ts: _ts, ...r }) => r); // 保存はソート済み・tsは捨てる
}

export async function GET() {
  const c = await cookies();
  const me = verifySession(c.get(MEMBER_COOKIE)?.value); // ログイン会員のID（無ければnull）
  const myGuest = await readGuest(); // 端末のゲストID（Cookie）

  const now = Date.now();
  let rows: Row[] | null = null;
  // 60秒以内のキャッシュがあればそれを使う（DB集計をスキップ）
  const cached = await get<{ payload: string; computed_at: number }>("SELECT payload, computed_at FROM ranking_cache WHERE id = 1");
  if (cached?.payload && now - Number(cached.computed_at) <= TTL_MS) {
    try {
      rows = JSON.parse(cached.payload) as Row[];
    } catch {
      rows = null;
    }
  }
  if (!rows) {
    rows = await computeRows();
    try {
      await run(
        "INSERT INTO ranking_cache (id, payload, computed_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at",
        [JSON.stringify(rows), now]
      );
    } catch {
      // キャッシュ書き込み失敗は無視（次回再計算）
    }
  }

  // 本人の順位（圏外でも算出）。idはレスポンスに出さない（プライバシー）。
  const meIdx = rows.findIndex((r) => (r.kind === "m" && !!me && r.id === me) || (r.kind === "g" && !!myGuest && r.id === myGuest));
  const ranking = rows.slice(0, 10).map((r, i) => ({ rank: i + 1, name: r.name, picture: r.picture, kinds: r.kinds, avatar: r.avatar || 0, isMe: i === meIdx }));
  const meRow = meIdx >= 0 ? { rank: meIdx + 1, name: rows[meIdx].name, picture: rows[meIdx].picture, kinds: rows[meIdx].kinds, avatar: rows[meIdx].avatar || 0, isMe: true } : null;
  // isMe（本人ハイライト）を含むので private。同一ブラウザの再表示だけ20秒キャッシュ。
  return NextResponse.json({ ranking, me: meRow, total: rows.length }, { headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" } });
}
