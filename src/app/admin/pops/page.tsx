import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { isAdmin } from "@/lib/auth";
import { TABLE_NAMES } from "@/lib/smaregi";

export const dynamic = "force-dynamic";

const SITE = "https://sake-library-plum.vercel.app";
const GILT = "#caa86a";

// 屋根（軒）付き杉玉ロゴ（同心リングの小円＝杉玉、上に切妻屋根）
function Sugidama({ size = 96 }: { size?: number }) {
  const cx = 50, cy = 70;
  const rings = [
    { r: 26, n: 30, s: 2.3 },
    { r: 20, n: 23, s: 2.2 },
    { r: 14, n: 16, s: 2.1 },
    { r: 8, n: 9, s: 2.0 },
    { r: 2.5, n: 1, s: 1.9 },
  ];
  const dots = rings.flatMap((ring, ri) =>
    Array.from({ length: ring.n }, (_, i) => {
      const a = (i / ring.n) * Math.PI * 2 + ri * 0.45;
      return { x: cx + Math.cos(a) * ring.r, y: cy + Math.sin(a) * ring.r, s: ring.s };
    })
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 102" fill={GILT} aria-hidden>
      {/* 切妻屋根 */}
      <path d="M50 14 L84 34 Q88.5 36.5 83.5 38.2 L16.5 38.2 Q11.5 36.5 16 34 Z" />
      <rect x="13.5" y="39.2" width="73" height="2.6" rx="1.3" />
      {/* 吊り紐 */}
      <rect x="48.7" y="42.5" width="2.6" height="6.5" rx="1" />
      {/* 杉玉 */}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.s} />
      ))}
    </svg>
  );
}

export default async function PopsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const pops = await Promise.all(
    TABLE_NAMES.map(async (name) => ({
      name,
      svg: await QRCode.toString(`${SITE}/t/${name}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
    }))
  );

  return (
    <main className="pops">
      <div className="no-print controls">
        <div>
          <p className="kicker">STAFF</p>
          <h1>卓POP（A4・{pops.length}卓）</h1>
          <p className="hint">各卓に1枚ずつ置くA4のPOPです。QRをお客様がスマホで読むと、その卓の日本酒メニュー＆図鑑が開きます。右下に卓番を小さく入れています。</p>
        </div>
        <button className="print-btn">🖨 全部印刷</button>
      </div>

      {pops.map((p) => (
        <section className="pop" key={p.name}>
          <div className="frame">
            <div className="zone ztop">
              <Sugidama size={88} />
              <p className="brand">酒コレ&nbsp;・&nbsp;酒神コレクション</p>
              <div className="rule" />
              <h2 className="tagline">飲んだ日本酒が、図鑑になる。</h2>
              <p className="lead">このお店の日本酒が、スマホの中で“図鑑”になる。</p>
            </div>

            <ul className="points zone">
              <li><span className="pn">本日の銘柄</span>今日飲める約40種を、味わいとともに</li>
              <li><span className="pn">AIで探す</span>好みを伝えると、貴方に合う一本をAIが提案</li>
              <li><span className="pn">図鑑を育てる</span>飲んだ一杯が記憶され、図鑑ランクが昇格</li>
              <li><span className="pn">図鑑ランキング</span>集めた銘柄数で、みんなと競えるランキング</li>
              <li><span className="pn">そのまま注文</span>気になる一本を、この画面から注文</li>
            </ul>

            <div className="zone zbot">
              <div className="qrcard" dangerouslySetInnerHTML={{ __html: p.svg }} />
              <p className="scan">スマホのカメラで読み取ってください</p>
              <p className="url">sake-library-plum.vercel.app</p>
            </div>

            <span className="tableno">{p.name}</span>
          </div>
        </section>
      ))}

      <script
        dangerouslySetInnerHTML={{ __html: `document.querySelector('.print-btn')?.addEventListener('click',()=>window.print());` }}
      />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Cormorant+Garamond:wght@500;600&family=Noto+Sans+JP:wght@400;500;700&display=swap');
        @page { size: A4; margin: 0; }
        .pops { background:#eceae5; }
        .controls { max-width: 820px; margin: 0 auto; padding: 32px 24px; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; font-family:'Noto Sans JP',sans-serif; }
        .kicker { font-size:11px; font-weight:700; letter-spacing:.3em; color:#7d7a73; }
        .controls h1 { font-size:22px; font-weight:700; margin-top:4px; color:#26282b; }
        .hint { font-size:12px; color:#6b6862; margin-top:6px; max-width:560px; line-height:1.7; }
        .print-btn { flex:none; background:#16352a; color:#fff; border:0; border-radius:999px; padding:12px 22px; font-size:14px; font-weight:700; cursor:pointer; }

        /* A4 POP本体 */
        .pop { width:210mm; height:297mm; margin:24px auto; background:
          radial-gradient(120% 90% at 50% 30%, #1d4031 0%, #16352a 52%, #0f2a20 100%);
          box-shadow:0 6px 30px rgba(0,0,0,.18); overflow:hidden; }
        /* 上(ロゴ/タグライン)・中(説明)・下(QR)を均等配置＝余白が散らからず高級感 */
        .frame { position:relative; width:100%; height:100%; box-sizing:border-box;
          padding:30mm 24mm; display:flex; flex-direction:column; align-items:center; justify-content:space-between; text-align:center;
          color:#f3efe6; font-family:'Noto Sans JP',sans-serif; }
        .frame::before { content:''; position:absolute; inset:10mm; border:1px solid rgba(202,168,106,.30); border-radius:3mm; pointer-events:none; }
        .zone { display:flex; flex-direction:column; align-items:center; width:100%; }

        .brand { margin-top:14px; color:${GILT}; font-family:'Cormorant Garamond',serif; font-weight:600; font-size:18px; letter-spacing:.34em; }
        .rule { width:60px; height:1.5px; margin:18px 0; background:linear-gradient(90deg,transparent, ${GILT}, transparent); }
        .tagline { font-family:'Shippori Mincho',serif; font-weight:600; font-size:33px; line-height:1.35; color:#fbf8f1; letter-spacing:.01em; white-space:nowrap; }
        .lead { margin-top:22px; font-size:14px; color:rgba(243,239,230,.8); letter-spacing:.02em; }

        .points { list-style:none; margin:0; padding:0; max-width:120mm; }
        .points li { display:flex; align-items:baseline; gap:14px; padding:13px 4px; font-size:13px; color:rgba(243,239,230,.8);
          border-bottom:1px solid rgba(202,168,106,.15); text-align:left; line-height:1.6; }
        .points li:last-child { border-bottom:0; }
        .pn { flex:none; width:104px; white-space:nowrap; color:${GILT}; font-family:'Shippori Mincho',serif; font-weight:600; font-size:13.5px; }

        .qrcard { width:50mm; height:50mm; padding:5.5mm; background:#fff; border-radius:4mm; box-shadow:0 10px 28px rgba(0,0,0,.28); }
        .qrcard svg { width:100%; height:100%; display:block; }
        .scan { margin-top:13px; font-size:12px; color:rgba(243,239,230,.72); letter-spacing:.04em; }
        .url { margin-top:14px; font-family:'Cormorant Garamond',serif; font-size:14px; letter-spacing:.12em; color:rgba(202,168,106,.85); }

        .tableno { position:absolute; right:12mm; bottom:11mm; font-family:'Cormorant Garamond',serif;
          font-size:13px; letter-spacing:.1em; color:rgba(202,168,106,.45); }

        @media print {
          .no-print { display:none; }
          .pops { background:#fff; }
          .pop { margin:0; box-shadow:none; break-after:page; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .pop:last-child { break-after:auto; }
        }
      `}</style>
    </main>
  );
}
