import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, run, get, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { openaiImageAvailable, imageModel, generateImageFromLabel, generateImageFromText, monsterPromptFromLabel, monsterPromptText, toGodArtWebp } from "@/lib/openai-image";
import { putImage, blobAvailable } from "@/lib/blob";
import { generateMonsterName } from "@/lib/ai";
import { rarityFor, region8For, breweryKey, type Rarity } from "@/lib/sakegami";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function counts() {
  // 全銘柄ベース（gods行が無い新規も「未生成」として数える＝「完了」が信頼できる）
  const t = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE archived = 0");
  const withArt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes s LEFT JOIN gods g ON g.sake_id = s.id WHERE s.archived = 0 AND g.god_art IS NOT NULL");
  const total = Number(t?.n) || 0;
  const done = Number(withArt?.n) || 0;
  return { total, done, remaining: total - done };
}

// 進捗確認
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 軽量化が必要なキャラ絵（=まだwebp化されていない既存絵）の件数。0なら「軽量化」ボタンは隠せる。
  // compress POST と同じ母集団（god_art IS NOT NULL・archived問わず）で数える。
  const un = await get<{ n: number }>("SELECT COUNT(*) AS n FROM gods WHERE god_art IS NOT NULL AND god_art_type <> 'image/webp'");
  return NextResponse.json({ configured: openaiImageAvailable(), unoptimized: Number(un?.n) || 0, ...(await counts()) });
}

type Target = { sake_id: number; brand: string; grade: string; prefecture: string; season_label: string; is_hidden: number; price: number | null; brewery: string; rarity: string | null; is_legend: number | null; photo: ArrayBuffer | Uint8Array | null; photo_type: string };

// 酒神モンスターを生成。絵＝ラベルから(gpt-image-1 edits)・名前＝創作モンスター名(Claude)。
// 既定は god_art が無い銘柄を limit 件だけ（残りはクライアントが続けて呼ぶ）。
// body.clear=true で全現役のキャラ絵をクリア（モンスターで作り直す前段）。
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { limit?: number; clear?: boolean; force?: boolean; compress?: boolean; sakeId?: number };

  // 単体生成：指定した1銘柄だけ酒神を生成/作り直し（他のキャラは一切変えない）。
  // 新規追加した日本酒の導線。gods行が無ければ決定論メタで作ってから絵を生成する。
  if (body.sakeId) {
    if (!openaiImageAvailable()) {
      return NextResponse.json({ error: "openai_unconfigured", message: "OPENAI_API_KEY を Vercel の環境変数に設定してください" }, { status: 503 });
    }
    const sid = Number(body.sakeId);
    const s = await get<{ brand: string; grade: string; prefecture: string; season_label: string; is_hidden: number; price: number | null; brewery: string; photo: ArrayBuffer | Uint8Array | null; photo_type: string }>(
      "SELECT brand, grade, prefecture, season_label, is_hidden, price, brewery, photo, photo_type FROM sakes WHERE id = ?",
      [sid]
    );
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const ex = await get<{ is_legend: number; name: string; kuchijo: string }>("SELECT is_legend, name, kuchijo FROM gods WHERE sake_id = ?", [sid]);
    const rarity = rarityFor({ price: s.price, grade: s.grade, seasonLabel: s.season_label, isHidden: !!s.is_hidden, brand: s.brand, isLegend: !!ex?.is_legend });
    // gods行を用意（既存の名前/口上/is_legendは保持）
    await run(
      `INSERT INTO gods (sake_id, store_id, name, rarity, kuchijo, region8, brewery_key, is_legend, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(sake_id) DO UPDATE SET rarity = excluded.rarity, region8 = excluded.region8, brewery_key = excluded.brewery_key, updated_at = excluded.updated_at`,
      [sid, ex?.name || s.brand.slice(0, 20), rarity, ex?.kuchijo || "", region8For(s.prefecture), breweryKey(s.brewery), ex?.is_legend ? 1 : 0]
    );
    try {
      const r = (rarity as Rarity) || "N";
      const nm = await generateMonsterName({ brand: s.brand, grade: s.grade, prefecture: s.prefecture, rarity: r });
      const label = s.photo ? Buffer.from(s.photo instanceof Uint8Array ? s.photo : new Uint8Array(s.photo)) : null;
      const opts = { brand: s.brand, rarity: r, seed: sid, season: s.season_label };
      let img: { data: Buffer; type: string };
      if (imageModel() === "gpt-image-1" && label) {
        img = await generateImageFromLabel(label, s.photo_type || "image/jpeg", monsterPromptFromLabel(opts));
      } else {
        img = await generateImageFromText(monsterPromptText(opts));
      }
      const small = await toGodArtWebp(img.data);
      let godUrl = "";
      if (blobAvailable()) {
        try { godUrl = await putImage(`god-art/${sid}.webp`, small.data, small.type); } catch {}
      }
      await run(
        `UPDATE gods SET god_art = ?, god_art_type = ?, god_art_url = ?,
           name = CASE WHEN ? <> '' THEN ? ELSE name END,
           kuchijo = CASE WHEN ? <> '' THEN ? ELSE kuchijo END,
           updated_at = datetime('now','localtime') WHERE sake_id = ?`,
        [small.data, small.type, godUrl, nm.name, nm.name, nm.kuchijo, nm.kuchijo, sid]
      );
      revalidatePath(`/sake/${sid}`);
      revalidatePath("/zukan");
      await audit("sakegami.art.one", { sakeId: sid });
      return NextResponse.json({ ok: true, generated: 1, sakeId: sid, name: nm.name, rarity });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 160) : "generation failed" }, { status: 500 });
    }
  }

  // 軽量化: 既存のキャラ絵を 512px WebP に圧縮（絵は変えず・サイズだけ）。表示を高速化。
  // BLOBは大きいので1件ずつ取得して処理（メモリ節約）。すでにwebpのものはスキップ。
  if (body.compress) {
    const list = await all<{ sake_id: number; god_art_type: string }>(
      "SELECT sake_id, god_art_type FROM gods WHERE god_art IS NOT NULL"
    );
    let compressed = 0;
    let skipped = 0;
    const failed: { id: number; error: string }[] = [];
    for (const g of list) {
      if (g.god_art_type === "image/webp") { skipped++; continue; }
      try {
        const row = await get<{ god_art: ArrayBuffer | Uint8Array | null }>("SELECT god_art FROM gods WHERE sake_id = ?", [g.sake_id]);
        if (!row?.god_art) { skipped++; continue; }
        const buf = Buffer.from(row.god_art instanceof Uint8Array ? row.god_art : new Uint8Array(row.god_art));
        const small = await toGodArtWebp(buf);
        let gurl = "";
        if (blobAvailable()) {
          try { gurl = await putImage(`god-art/${g.sake_id}.webp`, small.data, small.type); } catch {}
        }
        await run(
          "UPDATE gods SET god_art = ?, god_art_type = ?, god_art_url = ?, updated_at = datetime('now','localtime') WHERE sake_id = ?",
          [small.data, small.type, gurl, g.sake_id]
        );
        revalidatePath(`/sake/${g.sake_id}`);
        compressed++;
      } catch (e) {
        failed.push({ id: g.sake_id, error: e instanceof Error ? e.message.slice(0, 120) : "error" });
      }
    }
    revalidatePath("/zukan");
    await audit("sakegami.art.compress", { compressed, skipped, failed: failed.length });
    return NextResponse.json({ ok: true, compressed, skipped, failed, total: list.length });
  }

  // 作り直し: 既存のキャラ絵を全消去（この後 通常生成で全部モンスターに作り直す）
  if (body.clear) {
    await run("UPDATE gods SET god_art = NULL, god_art_type = '' WHERE sake_id IN (SELECT id FROM sakes WHERE archived = 0)");
    await audit("sakegami.art.clear", {});
    revalidatePath("/zukan");
    return NextResponse.json({ ok: true, cleared: true, ...(await counts()) });
  }

  if (!openaiImageAvailable()) {
    return NextResponse.json({ error: "openai_unconfigured", message: "OPENAI_API_KEY を Vercel の環境変数に設定してください" }, { status: 503 });
  }
  const limit = Math.max(1, Math.min(3, Number(body.limit) || 2));
  const canUseLabel = imageModel() === "gpt-image-1";

  // force=お試し（既存も上書き・先頭から）。通常は未生成(god_art IS NULL)のみ。
  // LEFT JOIN にして gods行がまだ無い新規銘柄も「未生成」として拾う（生成時に gods行を作る）。
  const where = body.force ? "s.archived = 0" : "s.archived = 0 AND g.god_art IS NULL";
  const targets = await all<Target>(
    `SELECT s.id AS sake_id, s.brand, s.grade, s.prefecture, s.season_label, s.is_hidden, s.price, s.brewery,
            g.rarity AS rarity, g.is_legend AS is_legend, s.photo, s.photo_type
       FROM sakes s LEFT JOIN gods g ON g.sake_id = s.id
      WHERE ${where}
      ORDER BY s.sort_order, s.id LIMIT ?`,
    [limit]
  );

  let generated = 0;
  const failed: { id: number; error: string }[] = [];
  for (const t of targets) {
    try {
      // gods行がまだ無い新規は rarity が NULL → 決定論で算出
      const rarity = (t.rarity as Rarity) || rarityFor({ price: t.price, grade: t.grade, seasonLabel: t.season_label, isHidden: !!t.is_hidden, brand: t.brand, isLegend: !!t.is_legend });
      // 1) 名前＝創作モンスター名（Claude・失敗しても絵は作る）
      const nm = await generateMonsterName({ brand: t.brand, grade: t.grade, prefecture: t.prefecture, rarity });
      // 2) 絵＝ラベルから（gpt-image-1 edits）。ラベル無し/非対応モデルは銘柄名から
      let img: { data: Buffer; type: string };
      const label = t.photo ? Buffer.from(t.photo instanceof Uint8Array ? t.photo : new Uint8Array(t.photo)) : null;
      const opts = { brand: t.brand, rarity, seed: t.sake_id, season: t.season_label };
      if (canUseLabel && label) {
        img = await generateImageFromLabel(label, t.photo_type || "image/jpeg", monsterPromptFromLabel(opts));
      } else {
        img = await generateImageFromText(monsterPromptText(opts));
      }
      // 軽量化：512px WebPで保存（表示を高速化。元の1024px PNGは保持しない）
      const small = await toGodArtWebp(img.data);
      // CDN(Blob)へ（あれば）。失敗時は god_art_url='' でDBのBLOB配信にフォールバック。
      let godUrl = "";
      if (blobAvailable()) {
        try { godUrl = await putImage(`god-art/${t.sake_id}.webp`, small.data, small.type); } catch {}
      }
      // 3) 保存（gods行が無ければ作る・あれば更新。名前/口上は取れた時だけ上書き）
      await run(
        `INSERT INTO gods (sake_id, store_id, god_art, god_art_type, god_art_url, name, kuchijo, rarity, region8, brewery_key, updated_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
         ON CONFLICT(sake_id) DO UPDATE SET
           god_art = excluded.god_art, god_art_type = excluded.god_art_type, god_art_url = excluded.god_art_url,
           name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE gods.name END,
           kuchijo = CASE WHEN excluded.kuchijo <> '' THEN excluded.kuchijo ELSE gods.kuchijo END,
           rarity = excluded.rarity, region8 = excluded.region8, brewery_key = excluded.brewery_key,
           updated_at = excluded.updated_at`,
        [t.sake_id, small.data, small.type, godUrl, nm.name, nm.kuchijo, rarity, region8For(t.prefecture), breweryKey(t.brewery)]
      );
      revalidatePath(`/sake/${t.sake_id}`);
      generated++;
    } catch (e) {
      failed.push({ id: t.sake_id, error: e instanceof Error ? e.message.slice(0, 140) : "error" });
    }
  }
  if (generated) revalidatePath("/zukan");
  await audit("sakegami.art", { generated, failed: failed.length });
  const c = await counts();
  return NextResponse.json({ ok: true, generated, failed, ...c });
}
