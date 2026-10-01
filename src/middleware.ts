import { NextRequest, NextResponse } from "next/server";

// /admin 配下をクッキーで保護する。
// 2026-10-01: 図鑑のゲストCookie発行と、QRアプリ内ブラウザのブロック（重複アカウント対策）はやめた。
// 客向けは 1 ページ（注文だけ）で、記録を持たないので、どのブラウザで開いても困らない。
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.cookies.get("sksl_staff")?.value) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
