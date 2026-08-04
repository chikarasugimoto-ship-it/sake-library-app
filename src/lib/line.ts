// LINEログイン（OAuth2）とセッション。サーバー専用。
import { createHmac, randomBytes } from "crypto";

const CHANNEL_ID = () => process.env.LINE_CHANNEL_ID || "";
const CHANNEL_SECRET = () => process.env.LINE_CHANNEL_SECRET || "";
const CALLBACK = () =>
  process.env.LINE_CALLBACK_URL || "https://sake-library-plum.vercel.app/api/auth/line/callback";

export const MEMBER_COOKIE = "sksl_member";
export const OAUTH_STATE_COOKIE = "sksl_oauth_state";

export function lineConfigured() {
  return !!(CHANNEL_ID() && CHANNEL_SECRET());
}

export function randomState(): string {
  return randomBytes(16).toString("hex");
}

// 公開図鑑ページ用の推測されにくいスラッグ
export function newSlug(): string {
  return randomBytes(7).toString("base64url");
}

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CHANNEL_ID(),
    redirect_uri: CALLBACK(),
    state,
    scope: "profile openid",
  });
  return "https://access.line.me/oauth2/v2.1/authorize?" + p.toString();
}

export async function exchangeCode(code: string): Promise<{ access_token: string }> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK(),
      client_id: CHANNEL_ID(),
      client_secret: CHANNEL_SECRET(),
    }),
  });
  if (!res.ok) throw new Error(`line token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function getProfile(accessToken: string): Promise<{
  userId: string;
  displayName: string;
  pictureUrl?: string;
}> {
  const res = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`line profile ${res.status}`);
  return res.json();
}

// セッションCookie = lineUserId + "." + HMAC（改ざん検知）
export function signSession(userId: string): string {
  const sig = createHmac("sha256", CHANNEL_SECRET()).update(userId).digest("base64url");
  return `${userId}.${sig}`;
}

export function verifySession(cookie?: string): string | null {
  if (!cookie) return null;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return null;
  const userId = cookie.slice(0, i);
  const sig = cookie.slice(i + 1);
  const expect = createHmac("sha256", CHANNEL_SECRET()).update(userId).digest("base64url");
  return sig === expect && userId ? userId : null;
}
