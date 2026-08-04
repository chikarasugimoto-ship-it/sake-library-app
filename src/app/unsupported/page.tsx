// QRをアプリ内ブラウザ/サードパーティQRアプリで読み取った場合の案内ページ。
// （middlewareがこのページへ誘導。Cookieが永続せず重複アカウントが生まれるのを防ぐため）
import { T } from "@/components/T";

const SITE_URL = "https://sake-library-plum.vercel.app";

export const metadata = { title: "読み取り方法のご案内 — 酒コレ（酒神コレクション）" };

export default function UnsupportedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-8 text-center">
      <div
        className="w-full rounded-3xl px-6 py-9 text-white"
        style={{ background: "linear-gradient(160deg,#1f4636,#0e2a20)", boxShadow: "0 18px 44px rgba(0,0,0,.35), inset 0 0 0 1px #caa86a44" }}
      >
        <p className="text-[11px] font-bold tracking-[0.3em] text-[#cdb27a]">酒コレ ・ 酒神コレクション</p>
        <div className="mt-5 text-4xl">📷</div>
        <h1 className="mt-3 text-[19px] font-bold leading-snug">
          <T
            ja={<>この読み取りアプリには<br />対応していません</>}
            en={<>This QR scanner<br />isn&apos;t supported</>}
          />
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-white/80">
          <T
            ja={<>QRコード読み取りアプリやSNSのアプリ内ブラウザでは、<b className="text-white">図鑑が正しく保存されません</b>（毎回データが消えてしまいます）。お手数ですが、次のいずれかでお願いします。</>}
            en={<>In QR-scanner apps and in-app browsers (social media, etc.), <b className="text-white">your collection won&apos;t save correctly</b> — your data is lost each time. Please use one of the methods below.</>}
          />
        </p>

        <div className="mt-6 space-y-3 text-left">
          <div className="rounded-2xl bg-white/10 px-4 py-3.5">
            <p className="text-[14px] font-bold">
              <T ja="① スマホ標準の「カメラ」で読み直す" en="① Rescan with your phone’s built-in Camera" />
            </p>
            <p className="mt-1 text-[12px] text-white/75">
              <T
                ja="iPhoneは標準「カメラ」アプリ、Androidは「カメラ」または「Google レンズ」でQRを写すと正しく開きます（いちばん簡単・確実）。"
                en="On iPhone, use the built-in Camera app; on Android, use Camera or Google Lens to scan the QR code — it opens correctly (easiest and most reliable)."
              />
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3.5">
            <p className="text-[14px] font-bold">
              <T ja="② このまま「ブラウザで開く」" en="② Or “Open in browser” from here" />
            </p>
            <p className="mt-1 text-[12px] text-white/75">
              <T
                ja={<>画面右上などの「︙」メニューから <b className="text-white">「ブラウザ（Safari / Chrome）で開く」</b> を選んでください。</>}
                en={<>Open the “︙” menu (usually top-right) and choose <b className="text-white">“Open in browser (Safari / Chrome)”</b>.</>}
              />
            </p>
          </div>
        </div>

        <p className="mt-6 text-[11px] text-white/55">
          <T ja="ご不明なときはスタッフへお声がけください。" en="If you need help, please ask our staff." />
        </p>
        <p className="mt-3 break-all text-[11px] text-[#cdb27a]">{SITE_URL}</p>
      </div>
    </main>
  );
}
