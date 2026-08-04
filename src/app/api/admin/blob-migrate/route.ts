import { NextResponse } from "next/server";
import { all, get, run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { blobAvailable, putImage } from "@/lib/blob";
import { toGodArtWebp } from "@/lib/openai-image";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 既存画像をDBのBLOBからCDN(Blob)へ移設。BLOBは残す（フォールバック）。
// 1回で最大LIMIT件・残りはクライアントが続けて呼ぶ（resumable）。

async function counts() {
  const pt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE photo IS NOT NULL");
  const pd = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE photo IS NOT NULL AND photo_url <> ''");
  const gt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM gods WHERE god_art IS NOT NULL");
  const gd = await get<{ n: number }>("SELECT COUNT(*) AS n FROM gods WHERE god_art IS NOT NULL AND god_art_url <> ''");
  const photos = { total: Number(pt?.n) || 0, done: Number(pd?.n) || 0 };
  const gods = { total: Number(gt?.n) || 0, done: Number(gd?.n) || 0 };
  return { photos, gods, remaining: photos.total - photos.done + (gods.total - gods.done) };
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: blobAvailable(), ...(await counts()) });
}

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobAvailable()) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN が未設定です（保管庫の接続をご確認ください）" }, { status: 503 });
  const LIMIT = 12;
  let migrated = 0;
  const failed: { kind: string; id: number; error: string }[] = [];

  // 1) 日本酒の写真
  const photos = await all<{ id: number; photo_type: string }>(
    "SELECT id, photo_type FROM sakes WHERE photo IS NOT NULL AND (photo_url IS NULL OR photo_url = '') LIMIT ?",
    [LIMIT]
  );
  for (const p of photos) {
    try {
      const row = await get<{ photo: ArrayBuffer | Uint8Array | null }>("SELECT photo FROM sakes WHERE id = ?", [p.id]);
      if (!row?.photo) continue;
      const buf = Buffer.from(row.photo instanceof Uint8Array ? row.photo : new Uint8Array(row.photo));
      const url = await putImage(`photos/${p.id}.jpg`, buf, p.photo_type || "image/jpeg");
      await run("UPDATE sakes SET photo_url = ? WHERE id = ?", [url, p.id]);
      migrated++;
    } catch (e) {
      failed.push({ kind: "photo", id: p.id, error: e instanceof Error ? e.message.slice(0, 100) : "err" });
    }
  }

  // 2) 酒神キャラ絵（残り枠で。未webpなら移行ついでに512px webp化）
  const remain = Math.max(0, LIMIT - photos.length);
  if (remain > 0) {
    const gods = await all<{ sake_id: number; god_art_type: string }>(
      "SELECT sake_id, god_art_type FROM gods WHERE god_art IS NOT NULL AND (god_art_url IS NULL OR god_art_url = '') LIMIT ?",
      [remain]
    );
    for (const g of gods) {
      try {
        const row = await get<{ god_art: ArrayBuffer | Uint8Array | null }>("SELECT god_art FROM gods WHERE sake_id = ?", [g.sake_id]);
        if (!row?.god_art) continue;
        let buf: Uint8Array = Buffer.from(row.god_art instanceof Uint8Array ? row.god_art : new Uint8Array(row.god_art));
        let type = g.god_art_type || "image/webp";
        if (type !== "image/webp") {
          const small = await toGodArtWebp(buf);
          buf = small.data;
          type = small.type;
          await run("UPDATE gods SET god_art = ?, god_art_type = ? WHERE sake_id = ?", [buf, type, g.sake_id]);
        }
        const url = await putImage(`god-art/${g.sake_id}.webp`, buf, "image/webp");
        await run("UPDATE gods SET god_art_url = ? WHERE sake_id = ?", [url, g.sake_id]);
        migrated++;
      } catch (e) {
        failed.push({ kind: "god", id: g.sake_id, error: e instanceof Error ? e.message.slice(0, 100) : "err" });
      }
    }
  }

  await audit("blob.migrate", { migrated, failed: failed.length });
  const c = await counts();
  return NextResponse.json({ ok: true, migrated, failed, ...c });
}
