import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { isAdmin } from "@/lib/auth";
import { TABLE_NAMES } from "@/lib/smaregi";

export const dynamic = "force-dynamic";

const SITE = "https://sake-library-plum.vercel.app";

export default async function TablesPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  // 実際の卓名（A1,A2,B1,B2,C1,C2,K1〜K13）でQRを生成
  const tables = await Promise.all(
    TABLE_NAMES.map(async (name) => ({
      n: name,
      url: `${SITE}/t/${name}`,
      svg: await QRCode.toString(`${SITE}/t/${name}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    }))
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="no-print">
        <p className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">STAFF</p>
        <h1 className="mt-1 text-2xl font-bold">卓QR（{tables.length}卓）</h1>
        <p className="mt-1 text-xs text-ink-soft">
          各卓に置くQRです。読むとその卓専用の日本酒注文画面が開きます。印刷して卓に設置してください。
        </p>
        <button className="print-btn mt-4 rounded-full bg-moss-deep px-5 py-2.5 text-sm font-bold text-white">
          🖨 全部印刷
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tables.map((t) => (
          <div key={t.n} className="qr-card flex flex-col items-center rounded-2xl border border-hairline bg-card p-4">
            <div className="text-sm font-bold text-moss-deep">卓 {t.n}</div>
            <div className="mt-2 h-32 w-32" dangerouslySetInnerHTML={{ __html: t.svg }} />
            <div className="mt-1 text-[9px] text-ink-soft">/t/{t.n}</div>
          </div>
        ))}
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelector('.print-btn')?.addEventListener('click',()=>window.print());`,
        }}
      />
      <style>{`
        @media print {
          .no-print { display: none; }
          .qr-card { break-inside: avoid; border-color:#ddd; }
        }
        .qr-card svg { width: 100%; height: 100%; }
      `}</style>
    </main>
  );
}
