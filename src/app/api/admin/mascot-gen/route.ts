import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { openaiImageAvailable, mascotPromptText, mascotRefinePrompt, mascotAdvisorPrompt, generateImageFromText, generateImageFromLabel, imageModel, toGodArtWebp } from "@/lib/openai-image";
import { putImage, blobAvailable } from "@/lib/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 店のマスコット「すぎだまる」をAI生成（gpt-image-1）。3案出して管理者が1枚採用。
// generate: 3案を作って 512px WebP の base64 で返す（軽い）。save: 採用した1枚を Blob に保存。
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; image_base64?: string; ref_base64?: string; ref_type?: string; variant?: string };
  const advisor = b.variant === "advisor"; // 相談役すぎだまる（眼鏡＋本・自由の女神ポーズ）

  if (b.action === "save") {
    if (!b.image_base64) return NextResponse.json({ error: "no_image" }, { status: 400 });
    if (!blobAvailable()) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN が未設定です（保管庫の接続をご確認ください）" }, { status: 503 });
    try {
      const buf = Buffer.from(b.image_base64, "base64");
      const path = advisor ? "mascot/sugidamaru-advisor.webp" : "mascot/sugidamaru.webp";
      const urlKey = advisor ? "mascot_advisor_url" : "mascot_url";
      const verKey = advisor ? "mascot_advisor_ver" : "mascot_ver";
      const url = await putImage(path, buf, "image/webp");
      const ver = Date.now().toString();
      await run(`INSERT INTO settings (key, value) VALUES ('${urlKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [url]);
      await run(`INSERT INTO settings (key, value) VALUES ('${verKey}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [ver]);
      await audit("mascot.save", { advisor });
      revalidatePath("/welcome");
      revalidatePath("/zukan");
      return NextResponse.json({ ok: true, url, ver });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 160) : "save failed" }, { status: 500 });
    }
  }

  // 既定: 生成
  if (!openaiImageAvailable()) {
    return NextResponse.json({ error: "openai_unconfigured", message: "OPENAI_API_KEY を Vercel の環境変数に設定してください" }, { status: 503 });
  }
  // 参考画像があれば「これベースで」描き直し(edits・gpt-image-1)。無ければテキストから生成。
  const useRef = typeof b.ref_base64 === "string" && b.ref_base64.length > 100;
  if (useRef && imageModel() !== "gpt-image-1") {
    return NextResponse.json({ error: "参考画像からの生成は gpt-image-1 が必要です（OPENAI_IMAGE_MODEL）" }, { status: 400 });
  }
  try {
    // 3案を並列生成 → それぞれ 512px WebP に圧縮して base64 で返す（表示用・軽量）
    const images = await Promise.all(
      [0, 1, 2].map(async () => {
        const png = useRef
          ? await generateImageFromLabel(Buffer.from(b.ref_base64 as string, "base64"), b.ref_type || "image/png", advisor ? mascotAdvisorPrompt() : mascotRefinePrompt())
          : await generateImageFromText(mascotPromptText());
        const webp = await toGodArtWebp(png.data);
        return webp.data.toString("base64");
      })
    );
    await audit("mascot.generate", { n: images.length, ref: useRef });
    return NextResponse.json({ ok: true, images });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "generation failed" }, { status: 500 });
  }
}
