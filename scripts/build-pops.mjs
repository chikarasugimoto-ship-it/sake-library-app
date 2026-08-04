// 卓POP（A4・全19卓）の自己完結HTMLを生成。Chromeヘッドレスで印刷品質PDFにするための元データ。
// 使い方: node scripts/build-pops.mjs  → out/pops.html を生成
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://sake-library-plum.vercel.app";
const GILT = "#caa86a";
const TABLES = ["A1","A2","B1","B2","C1","C2","K1","K2","K3","K4","K5","K6","K7","K8","K9","K10","K11","K12","K13"];

// 屋根付き杉玉ロゴ（インラインSVG）
function sugidama(size = 88) {
  const cx = 50, cy = 70;
  const rings = [
    { r: 26, n: 30, s: 2.3 }, { r: 20, n: 23, s: 2.2 }, { r: 14, n: 16, s: 2.1 },
    { r: 8, n: 9, s: 2.0 }, { r: 2.5, n: 1, s: 1.9 },
  ];
  let dots = "";
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ri * 0.45;
      dots += `<circle cx="${(cx + Math.cos(a) * ring.r).toFixed(2)}" cy="${(cy + Math.sin(a) * ring.r).toFixed(2)}" r="${ring.s}"/>`;
    }
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 102" fill="${GILT}" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 14 L84 34 Q88.5 36.5 83.5 38.2 L16.5 38.2 Q11.5 36.5 16 34 Z"/>
    <rect x="13.5" y="39.2" width="73" height="2.6" rx="1.3"/>
    <rect x="48.7" y="42.5" width="2.6" height="6.5" rx="1"/>${dots}</svg>`;
}

function popHtml(name, qrSvg) {
  return `<section class="pop"><div class="frame">
    <div class="zone ztop">
      ${sugidama(88)}
      <p class="brand">SUGIDAMA&nbsp;&nbsp;SAKE&nbsp;&nbsp;LIBRARY</p>
      <div class="rule"></div>
      <h2 class="tagline">飲んだ日本酒が、図鑑になる。</h2>
      <p class="lead">このお店の日本酒が、スマホの中で“図鑑”になる。</p>
    </div>
    <ul class="points zone">
      <li><span class="pn">本日の銘柄</span>今日飲める約40種を、味わいとともに</li>
      <li><span class="pn">AIで探す</span>好みを伝えると、貴方に合う一本をAIが提案</li>
      <li><span class="pn">図鑑を育てる</span>飲んだ一杯が記憶され、図鑑ランクが昇格</li>
      <li><span class="pn">図鑑ランキング</span>集めた銘柄数で、みんなと競えるランキング</li>
      <li><span class="pn">そのまま注文</span>気になる一本を、この画面から注文</li>
    </ul>
    <div class="zone zbot">
      <div class="qrcard">${qrSvg}</div>
      <p class="scan">スマホのカメラで読み取ってください</p>
      <p class="url">sake-library-plum.vercel.app</p>
    </div>
    <span class="tableno">${name}</span>
  </div></section>`;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Cormorant+Garamond:wght@500;600&family=Noto+Sans+JP:wght@400;500;700&display=swap');
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html,body { margin:0; padding:0; }
.pop { width:210mm; height:297mm; background:
  radial-gradient(120% 90% at 50% 30%, #1d4031 0%, #16352a 52%, #0f2a20 100%);
  overflow:hidden; break-after:page; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.pop:last-child { break-after:auto; }
.frame { position:relative; width:100%; height:100%; padding:30mm 24mm; display:flex; flex-direction:column;
  align-items:center; justify-content:space-between; text-align:center; color:#f3efe6; font-family:'Noto Sans JP',sans-serif; }
.frame::before { content:''; position:absolute; inset:10mm; border:1px solid rgba(202,168,106,.30); border-radius:3mm; pointer-events:none; }
.zone { display:flex; flex-direction:column; align-items:center; width:100%; }
.brand { margin:14px 0 0; color:${GILT}; font-family:'Cormorant Garamond',serif; font-weight:600; font-size:18px; letter-spacing:.34em; }
.rule { width:60px; height:1.5px; margin:18px 0; background:linear-gradient(90deg,transparent, ${GILT}, transparent); }
.tagline { margin:0; font-family:'Shippori Mincho',serif; font-weight:600; font-size:33px; line-height:1.35; color:#fbf8f1; letter-spacing:.01em; white-space:nowrap; }
.lead { margin:22px 0 0; font-size:14px; color:rgba(243,239,230,.8); letter-spacing:.02em; }
.points { list-style:none; margin:0; padding:0; max-width:120mm; }
.points li { display:flex; align-items:baseline; gap:14px; padding:13px 4px; font-size:13px; color:rgba(243,239,230,.8);
  border-bottom:1px solid rgba(202,168,106,.15); text-align:left; line-height:1.6; }
.points li:last-child { border-bottom:0; }
.pn { flex:none; width:104px; white-space:nowrap; color:${GILT}; font-family:'Shippori Mincho',serif; font-weight:600; font-size:13.5px; }
.qrcard { width:50mm; height:50mm; padding:5.5mm; background:#fff; border-radius:4mm; }
.qrcard svg { width:100%; height:100%; display:block; }
.scan { margin:13px 0 0; font-size:12px; color:rgba(243,239,230,.72); letter-spacing:.04em; }
.url { margin:14px 0 0; font-family:'Cormorant Garamond',serif; font-size:14px; letter-spacing:.12em; color:rgba(202,168,106,.85); }
.tableno { position:absolute; right:12mm; bottom:11mm; font-family:'Cormorant Garamond',serif; font-size:13px; letter-spacing:.1em; color:rgba(202,168,106,.45); }
`;

const pops = await Promise.all(TABLES.map(async (name) => {
  const svg = await QRCode.toString(`${SITE}/t/${name}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return popHtml(name, svg);
}));

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pops.join("")}</body></html>`;
const outDir = path.join(root, "out");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "pops.html");
fs.writeFileSync(outPath, html, "utf8");
console.log("生成:", outPath, "／", TABLES.length, "卓");
