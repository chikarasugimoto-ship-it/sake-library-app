// QR読み取り元の判定（純粋関数・middleware/Edgeでも使える）。
// 目的: サードパーティQRアプリ/SNSのアプリ内ブラウザ(使い捨てWebView)はCookieを永続できず、
// 読み取りのたびに別ゲスト=重複アカウントが生まれる。これらをブロックし、端末標準カメラ
// (iOS Safari / Android Chrome＝Cookie永続)へ誘導するために検知する。
// 方針: 実ブラウザ・デスクトップは誤ブロックしない保守的判定（明確なアプリ内WebViewのみtrue）。
export function isInAppBrowser(ua: string): boolean {
  if (!ua) return false;

  // 既知のアプリ内ブラウザ（LINE/Facebook/Instagram/X/WeChat/KakaoTalk/TikTok等）
  if (/(Line\/|FBAN|FBAV|FB_IAB|FBIOS|Instagram|\bTwitter\b|MicroMessenger|KAKAOTALK|Snapchat|Pinterest|TikTok|musical_ly|YJApp|SmartNews|Gmail|GSA\/)/i.test(ua)) {
    return true;
  }

  const isiOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  if (isiOS) {
    // iOSの実ブラウザは必ず Safari/ か 各ブラウザ専用トークンを持つ。
    // WKWebView(アプリ内)は Safari/ トークンを持たない＝実ブラウザでなければアプリ内とみなす。
    const realIosBrowser = /(Safari\/|CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\/|GSA\/)/.test(ua);
    return /AppleWebKit/.test(ua) && !realIosBrowser;
  }

  if (isAndroid) {
    // Android System WebView の確実な目印（実Chromeには付かない）
    return /;\s*wv\)/.test(ua) || /\bwv\b/.test(ua);
  }

  // デスクトップ等はQRの問題が無く、スタッフ利用もあるため対象外
  return false;
}
