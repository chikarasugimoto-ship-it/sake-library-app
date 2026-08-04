// 画像のCDN配信用：Vercel Blob へのアップロード（サーバー専用）。
// BLOB_READ_WRITE_TOKEN（保管庫 sake-images を接続すると自動設定）が無い環境では no-op。
import { put } from "@vercel/blob";

export function blobAvailable(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// 安定したパス名で公開アップロード（同じ酒/酒神は上書き）。成功でCDNのURLを返す。
// pathname 例: "photos/12.jpg" / "god-art/12.webp"
export async function putImage(pathname: string, data: Buffer | Uint8Array, contentType: string): Promise<string> {
  if (!blobAvailable()) throw new Error("BLOB_READ_WRITE_TOKEN が未設定です");
  const body: Buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const res = await put(pathname, body, {
    access: "public",
    contentType,
    allowOverwrite: true,
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    cacheControlMaxAge: 31536000, // 1年（中身が変わるときはURLのバージョン付与側で更新）
  });
  return res.url;
}
