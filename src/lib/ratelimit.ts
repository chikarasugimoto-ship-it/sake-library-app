// 簡易レート制限（サーバーレス・インスタンス内のベストエフォート）。
// 1台の端末/スクリプトの連投でサービスが重くなる・AIコストが膨らむのを防ぐ目的。
// 通常のお客様利用はブロックしない緩い値で使うこと。
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false; // 超過
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) {
    // メモリ肥大の保険：古いキーを一掃
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
  }
  return true;
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "unknown";
}
