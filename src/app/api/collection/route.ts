import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, MEMBER_COOKIE } from "@/lib/line";
import { readGuest, newGuestId, guestCookieOptions, GUEST_COOKIE } from "@/lib/guest";
import { all, get, run } from "@/lib/db";
import { issueRewards, listRewards, claimGod, pendingMilestones } from "@/lib/rewards";

async function kindsOf(table: "member_tasted" | "guest_tasted", col: "line_user_id" | "guest_id", id: string): Promise<number> {
  const r = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [id]);
  return Number(r?.n) || 0;
}

async function currentMember(): Promise<string | null> {
  const c = await cookies();
  return verifySession(c.get(MEMBER_COOKIE)?.value);
}

type TastedMap = Record<number, { count: number; date: string }>;

async function memberTasted(uid: string): Promise<TastedMap> {
  const rows = await all<{ sake_id: number; tasted_date: string; count: number }>(
    "SELECT sake_id, tasted_date, count FROM member_tasted WHERE line_user_id = ?",
    [uid]
  );
  const t: TastedMap = {};
  for (const r of rows) t[r.sake_id] = { count: Number(r.count) || 1, date: r.tasted_date || "" };
  return t;
}
async function guestTasted(gid: string): Promise<TastedMap> {
  const rows = await all<{ sake_id: number; tasted_date: string; count: number }>(
    "SELECT sake_id, tasted_date, count FROM guest_tasted WHERE guest_id = ?",
    [gid]
  );
  const t: TastedMap = {};
  for (const r of rows) t[r.sake_id] = { count: Number(r.count) || 1, date: r.tasted_date || "" };
  return t;
}

export async function GET() {
  const uid = await currentMember();
  if (uid) {
    // 自己修復：同じ端末にゲスト図鑑(guest_tasted)が残っていたら会員へ統合してゲストを消す。
    // これでLINE連携時の「ゲスト＋会員の二重アカウント（ランキング二重表示）」を防ぐ＆既存分も次回開いた時に直る。
    try {
      const gid = await readGuest();
      if (gid) {
        const gc = await get<{ n: number }>("SELECT COUNT(*) AS n FROM guest_tasted WHERE guest_id = ?", [gid]);
        if (Number(gc?.n) > 0) {
          await run(
            `INSERT INTO member_tasted (line_user_id, sake_id, tasted_date, count)
               SELECT ?, sake_id, tasted_date, count FROM guest_tasted WHERE guest_id = ?
             ON CONFLICT(line_user_id, sake_id) DO NOTHING`,
            [uid, gid]
          );
          await run("DELETE FROM guest_tasted WHERE guest_id = ?", [gid]);
          await run("DELETE FROM guests WHERE guest_id = ?", [gid]);
          await run("UPDATE ranking_cache SET computed_at = 0 WHERE id = 1"); // ランキング再集計を促す
          await issueRewards("member", uid, await kindsOf("member_tasted", "line_user_id", uid)); // 統合後の種類数で節目を再発行
        }
      }
    } catch {
      // 統合に失敗しても図鑑表示は続ける
    }
    // 逐次→並列（往復回数を1回ぶんに圧縮＝アカウントステータスの取得を高速化）
    const [m, tasted, rewardsFetched] = await Promise.all([
      get<{ display_name: string; nickname: string; picture_url: string; show_on_ranking: number; public_slug: string; avatar_sake_id: number }>(
        "SELECT display_name, nickname, picture_url, show_on_ranking, public_slug, avatar_sake_id FROM members WHERE line_user_id = ?",
        [uid]
      ),
      memberTasted(uid),
      listRewards("member", uid),
    ]);
    // 節目変更（50種ごと→30種ごと・2026-08-18）の遡及: 図鑑を開いた時点で不足の節目があれば発行。
    // 手元のrewards一覧との突合で不足が見える時だけDBへ書く（普段のオープンは追加往復なし・冪等）。
    let rewards = rewardsFetched;
    try {
      if (pendingMilestones(Object.keys(tasted).length, rewards.map((r) => r.reason)).length > 0) {
        await issueRewards("member", uid, Object.keys(tasted).length);
        rewards = await listRewards("member", uid);
      }
    } catch {
      // 発行に失敗しても図鑑表示は続ける（次のオープン/注文時に再判定される）
    }
    return NextResponse.json({
      member: { name: (m?.nickname || m?.display_name) ?? "", picture: m?.picture_url ?? "", onRanking: !!m?.show_on_ranking, slug: m?.public_slug ?? "" },
      tasted,
      rewards,
      avatarSakeId: Number(m?.avatar_sake_id) || 0,
    });
  }
  // 匿名：ゲストCookieで図鑑をサーバー保存。無ければ発行してセット。
  const existing = await readGuest();
  const gid = existing || newGuestId();
  let tasted: TastedMap = {};
  let rewards: Awaited<ReturnType<typeof listRewards>> = [];
  let avatarSakeId = 0;
  if (existing) {
    const [t, rw, g] = await Promise.all([
      guestTasted(gid),
      listRewards("guest", gid),
      get<{ avatar_sake_id: number }>("SELECT avatar_sake_id FROM guests WHERE guest_id = ?", [gid]),
    ]);
    tasted = t;
    rewards = rw;
    avatarSakeId = Number(g?.avatar_sake_id) || 0;
    // 節目変更（50種ごと→30種ごと・2026-08-18）の遡及発行（会員側GETと同じ・不足がある時だけ）
    try {
      if (pendingMilestones(Object.keys(tasted).length, rewards.map((r) => r.reason)).length > 0) {
        await issueRewards("guest", gid, Object.keys(tasted).length);
        rewards = await listRewards("guest", gid);
      }
    } catch {
      // 発行に失敗しても図鑑表示は続ける
    }
  }
  const res = NextResponse.json({ member: null, guest: true, tasted, rewards, avatarSakeId });
  if (!existing) res.cookies.set(GUEST_COOKIE, gid, guestCookieOptions());
  return res;
}

export async function POST(req: NextRequest) {
  const uid = await currentMember();
  const b = (await req.json().catch(() => ({}))) as { action?: string; sakeId?: number; value?: boolean; date?: string; qty?: number; name?: string; grantId?: number };

  // 隠し酒プレゼントの「客側引換」＝マイルストーン特典で選んだ隠し酒の酒神を図鑑に迎える。
  // 本人確認→提供中の隠し酒→未収集 を rewards.ts claimGod で検証し、神おろし演出データを返す。
  // 物理提供（スタッフのコード消し込み＝status）とは別軸。会員/ゲスト両対応。
  if (b.action === "claim-god") {
    const grantId = Math.floor(Number(b.grantId) || 0);
    const pickId = Math.floor(Number(b.sakeId) || 0);
    let ownerKind: "member" | "guest" = "member";
    let ownerId = uid || "";
    if (!uid) {
      ownerKind = "guest";
      ownerId = (await readGuest()) || "";
    }
    if (!ownerId) return NextResponse.json({ error: "no owner" }, { status: 400 });
    const r = await claimGod(ownerKind, ownerId, grantId, pickId, b.date || "");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    // 迎えたことで種類数が増え、次の節目に届く場合があるので再発行（冪等）＋ランキング再集計を促す
    const kinds =
      ownerKind === "member"
        ? await kindsOf("member_tasted", "line_user_id", ownerId)
        : await kindsOf("guest_tasted", "guest_id", ownerId);
    await issueRewards(ownerKind, ownerId, kinds);
    await run("UPDATE ranking_cache SET computed_at = 0 WHERE id = 1");
    return NextResponse.json({ ok: true, god: r.god });
  }

  // 会員専用：ランキング参加・表示名（ゲストは端末側で扱う）
  if (b.action === "ranking" || b.action === "name") {
    if (!uid) return NextResponse.json({ ok: true }); // ゲストはサーバー処理なし
    if (b.action === "ranking") await run("UPDATE members SET show_on_ranking = ? WHERE line_user_id = ?", [b.value ? 1 : 0, uid]);
    else await run("UPDATE members SET nickname = ? WHERE line_user_id = ?", [String(b.name ?? "").trim().slice(0, 12), uid]);
    return NextResponse.json({ ok: true });
  }

  // アイコン（プロフィール画像）＝集めた酒神の sake_id。0 で既定（位アイコン）に戻す。会員/ゲスト両対応。
  if (b.action === "avatar") {
    const aid = Math.max(0, Math.floor(Number(b.sakeId) || 0));
    if (uid) {
      await run("UPDATE members SET avatar_sake_id = ? WHERE line_user_id = ?", [aid, uid]);
      return NextResponse.json({ ok: true });
    }
    const existing = await readGuest();
    const gid = existing || newGuestId();
    await run(
      "INSERT INTO guests (guest_id, avatar_sake_id) VALUES (?, ?) ON CONFLICT(guest_id) DO UPDATE SET avatar_sake_id = excluded.avatar_sake_id, updated_at = datetime('now','localtime')",
      [gid, aid]
    );
    const res = NextResponse.json({ ok: true });
    if (!existing) res.cookies.set(GUEST_COOKIE, gid, guestCookieOptions());
    return res;
  }

  const sakeId = Number(b.sakeId);
  if (!sakeId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // 図鑑への登録：会員は member_tasted、匿名はゲストCookieで guest_tasted に保存
  if (uid) {
    if (b.action === "tasted") {
      if (b.value) await run("INSERT INTO member_tasted (line_user_id, sake_id, tasted_date, count) VALUES (?, ?, ?, 1) ON CONFLICT(line_user_id, sake_id) DO NOTHING", [uid, sakeId, b.date || ""]);
      else await run("DELETE FROM member_tasted WHERE line_user_id = ? AND sake_id = ?", [uid, sakeId]);
    } else if (b.action === "drink") {
      const qty = Math.max(1, Math.min(99, Number(b.qty) || 1));
      await run(`INSERT INTO member_tasted (line_user_id, sake_id, tasted_date, count) VALUES (?, ?, ?, ?) ON CONFLICT(line_user_id, sake_id) DO UPDATE SET count = count + ?`, [uid, sakeId, b.date || "", qty, qty]);
    } else return NextResponse.json({ error: "bad action" }, { status: 400 });
    // 種類が増えた可能性があれば、隠し酒プレゼントの節目を判定して発行（冪等）
    if (b.action === "drink" || (b.action === "tasted" && b.value)) {
      await issueRewards("member", uid, await kindsOf("member_tasted", "line_user_id", uid));
    }
    return NextResponse.json({ ok: true });
  }

  // 匿名（ゲスト）
  const existing = await readGuest();
  const gid = existing || newGuestId();
  if (b.action === "tasted") {
    if (b.value) await run("INSERT INTO guest_tasted (guest_id, sake_id, tasted_date, count) VALUES (?, ?, ?, 1) ON CONFLICT(guest_id, sake_id) DO NOTHING", [gid, sakeId, b.date || ""]);
    else await run("DELETE FROM guest_tasted WHERE guest_id = ? AND sake_id = ?", [gid, sakeId]);
  } else if (b.action === "drink") {
    const qty = Math.max(1, Math.min(99, Number(b.qty) || 1));
    await run(`INSERT INTO guest_tasted (guest_id, sake_id, tasted_date, count) VALUES (?, ?, ?, ?) ON CONFLICT(guest_id, sake_id) DO UPDATE SET count = count + ?`, [gid, sakeId, b.date || "", qty, qty]);
  } else return NextResponse.json({ error: "bad action" }, { status: 400 });
  // 種類が増えた可能性があれば、隠し酒プレゼントの節目を判定して発行（冪等）
  if (b.action === "drink" || (b.action === "tasted" && b.value)) {
    await issueRewards("guest", gid, await kindsOf("guest_tasted", "guest_id", gid));
  }
  const res = NextResponse.json({ ok: true });
  if (!existing) res.cookies.set(GUEST_COOKIE, gid, guestCookieOptions());
  return res;
}
