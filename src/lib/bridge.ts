// MO（sugidama-mo）→ 酒コレ 会員 橋渡しの検証（案②・最短版）。
// MOが共有シークレット(SAKE_BRIDGE_SECRET)で署名した「不可逆ハッシュID(ext)＋表示名」を検証する。
// 検証OKなら line_user_id="mo:<ext>" の会員としてログインさせる（MOで連携すれば酒神コレクションが同一人物で保存）。
// env未設定なら常にnull＝橋渡し無効（従来どおりゲスト/酒コレ独自ログインで動く・安全）。
import { createHmac } from "crypto";

const SECRET = () => process.env.SAKE_BRIDGE_SECRET || "";

export function verifyBridge(token: string): { ext: string; name: string } | null {
  const secret = SECRET();
  if (!secret || !token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
  if (sig !== expect) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: string; n?: string; t?: number };
    if (!o.e || typeof o.e !== "string") return null;
    // 期限15分（発行から時間が経ったトークンは無効＝URL流用を抑止）
    if (typeof o.t === "number" && Date.now() - o.t > 15 * 60 * 1000) return null;
    return { ext: o.e, name: String(o.n || "").slice(0, 40) };
  } catch {
    return null;
  }
}
