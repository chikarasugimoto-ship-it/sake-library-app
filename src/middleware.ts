import { NextRequest, NextResponse } from "next/server";
import { isInAppBrowser } from "@/lib/useragent";

// /admin 配下をクッキーで保護＋客向けページで図鑑のゲストCookieを発行する。
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 管理画面：クッキーが無ければログインへ
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.cookies.get("sksl_staff")?.value) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
  }

  const isCustomer = pathname === "/" || pathname === "/welcome" || pathname === "/zukan" || pathname.startsWith("/sake/");

  // 【QR読み取り対策・完全ブロック】サードパーティQRアプリ/SNSのアプリ内ブラウザ(使い捨てWebView)は
  // Cookieを永続できず重複アカウントが生まれるため、客向けページでは使わせず案内ページへ誘導する。
  // 端末標準カメラ(iOS Safari / Android Chrome)・PCは通常どおり利用可。
  // 【例外】LINEアプリ内ブラウザは通す: モバイルオーダー(LIFF)→ブリッジで会員連携して来る正規ルートで、
  //   図鑑は member_tasted にサーバー保存される（＝重複アカウント/データ消失は起きない）。Cookieも永続する。
  const ua = req.headers.get("user-agent") || "";
  const isLine = /Line\//i.test(ua);
  if (isCustomer && !isLine && isInAppBrowser(ua)) {
    const url = req.nextUrl.clone();
    url.pathname = "/unsupported";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();

  // 客向けページでは、図鑑のゲストID(sksl_guest)を「実ページ(200応答)」で発行＝iOS Safariでも確実に残る。
  // （302リダイレクトのSet-CookieはiOSで落ちることがあるため、ここで確実に付ける）
  if (isCustomer) {
    const g = req.cookies.get("sksl_guest")?.value || "";
    if (!/^g_[a-z0-9]{8,64}$/i.test(g)) {
      res.cookies.set("sksl_guest", "g_" + crypto.randomUUID().replace(/-/g, ""), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365, // 1年
        path: "/",
      });
    }
  }
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/", "/welcome", "/zukan", "/sake/:path*"],
};
