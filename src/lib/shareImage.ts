// 図鑑の「今日の一杯＋これまでのコレクション」を1枚の縦長カード（深緑×箔・明朝）にする。
// 女性ターゲットの“投稿したくなる”SNS用。Canvasで描画 → Blob（アプリ実行時なのでDate等の制約なし）。

export type ShareData = {
  storeName: string; // 煮干しと日本酒 すぎだま
  heroLabel: string; // 「本日の一献」など
  featuredName: string; // 本日/最近の一本の銘柄名
  featuredColor: string; // 写真が無いとき描く瓶の色
  featuredPhotoUrl?: string; // 本日の一本の写真URL（あれば写真、無ければ瓶イラスト）
  subLine: string; // 「ほか2本 ・ 本日3本を図鑑に記録」など
  collectedKinds: number; // これまでに集めた種類数
  rankName: string; // 現在の位
  url: string; // フッターURL
  format?: "feed" | "story"; // feed=4:5(1080×1350) / story=9:16(1080×1920)。既定feed
  // 酒神（獲得演出のキャラ）を主役にする場合。指定があれば写真/瓶の代わりにキャラをヒーロー表示。
  godArtUrl?: string; // 酒神キャラ絵URL
  godRarityLabel?: string; // 「SR・スーパーレア」などのバッジ表記
  godFrameColor?: string; // レア度色（フレーム・ステージの淡色）
};

const GREEN_1 = "#1f4636";
const GREEN_2 = "#163a2c";
const GREEN_3 = "#0e2a20";
const GILT = "#caa86a";
const GILT_HI = "#e8d1a0";
const CREAM = "#f3efe6";
const CREAM_2 = "#f1e6cf";
const MINCHO = "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
const SERIF_NUM = "'Georgia','Times New Roman',serif";
const ROMAN = "'Times New Roman',serif";

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 文字間隔つき中央寄せ描画（明朝の見出しを上品に見せる）
function fillTextTracked(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prev;
}

// 銘柄名が枠幅に収まるようフォントサイズを自動調整して中央描画
function fitCenteredText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, startPx: number, weight: string, family: string) {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${family}`;
  while (ctx.measureText(text).width > maxW && px > 22) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  ctx.textAlign = "center";
  ctx.fillText(text, cx, y);
}

// #rrggbb / #rgb → rgba(...) （レア度色を淡く敷くため）
function withAlpha(hex: string, a: number): string {
  const h = (hex || "").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// 角丸枠に object-fit:cover で写真を描く
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const ir = img.width / img.height;
  const br = w / h;
  let dw = w, dh = h, dx = x, dy = y;
  if (ir > br) {
    dh = h;
    dw = h * ir;
    dx = x - (dw - w) / 2;
  } else {
    dw = w;
    dh = w / ir;
    dy = y - (dh - h) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawBottle(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, color: string) {
  const h = w * 2.7;
  const x = cx - w / 2;
  ctx.save();
  ctx.fillStyle = color;
  const neckW = w * 0.36;
  roundRectPath(ctx, cx - neckW / 2, top, neckW, h * 0.22, neckW * 0.3);
  ctx.fill();
  roundRectPath(ctx, x, top + h * 0.16, w, h * 0.84, w * 0.26);
  ctx.fill();
  // 和紙ラベル
  ctx.fillStyle = "#f6f2ea";
  roundRectPath(ctx, x + w * 0.18, top + h * 0.46, w * 0.64, h * 0.34, w * 0.06);
  ctx.fill();
  ctx.fillStyle = GILT;
  ctx.fillRect(x + w * 0.3, top + h * 0.54, w * 0.4, 2);
  ctx.fillRect(x + w * 0.3, top + h * 0.72, w * 0.4, 2);
  ctx.restore();
}

// 軒（屋根）付き杉玉ロゴ
function drawSugidama(ctx: CanvasRenderingContext2D, cx: number, top: number, scale: number, color: string) {
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.lineTo(33, -20);
  ctx.quadraticCurveTo(38, -17, 33, -15.5);
  ctx.lineTo(-33, -15.5);
  ctx.quadraticCurveTo(-38, -17, -33, -20);
  ctx.closePath();
  ctx.fill();
  roundRectPath(ctx, -34, -14, 68, 2.4, 1.2);
  ctx.fill();
  roundRectPath(ctx, -1.2, -11, 2.4, 8, 1);
  ctx.fill();
  const rings = [
    { r: 25, n: 28, s: 2.9 },
    { r: 19, n: 21, s: 2.8 },
    { r: 13, n: 14, s: 2.6 },
    { r: 7, n: 8, s: 2.5 },
    { r: 2, n: 1, s: 2.4 },
  ];
  const cy = 16;
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ri * 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * ring.r, cy + Math.sin(a) * ring.r, ring.s, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function hairline(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number) {
  const lg = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  lg.addColorStop(0, "rgba(202,168,106,0)");
  lg.addColorStop(0.5, GILT_HI);
  lg.addColorStop(1, "rgba(202,168,106,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(cx - w / 2, y, w, 2);
}

export async function buildShareImage(data: ShareData): Promise<Blob> {
  const W = 1080;
  const CARD_H = 1350;
  const story = data.format === "story";
  const H = story ? 1920 : CARD_H; // ストーリーは9:16
  const OY = (H - CARD_H) / 2; // カード(1080×1350)を縦中央に配置
  const CX = W / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  // 写真・酒神キャラは先に読み込む（あれば）。酒神があればそれを主役にする。
  const godArt = data.godArtUrl ? await loadImage(data.godArtUrl) : null;
  const photo = !godArt && data.featuredPhotoUrl ? await loadImage(data.featuredPhotoUrl) : null;

  // 背景（深緑の放射グラデ・全面）
  const g = ctx.createRadialGradient(CX, OY + CARD_H * 0.32, W * 0.1, CX, OY + CARD_H * 0.5, CARD_H * 0.9);
  g.addColorStop(0, GREEN_1);
  g.addColorStop(0.52, GREEN_2);
  g.addColorStop(1, GREEN_3);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 以降はカード座標(1080×1350)で描画。ストーリーはOYぶん下げて中央寄せ
  ctx.save();
  ctx.translate(0, OY);

  // 箔の二重フレーム
  const fg = ctx.createLinearGradient(54, 54, W - 54, CARD_H - 54);
  fg.addColorStop(0, GILT_HI);
  fg.addColorStop(0.5, GILT);
  fg.addColorStop(1, "#a9854c");
  ctx.strokeStyle = fg;
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.9;
  roundRectPath(ctx, 54, 54, W - 108, CARD_H - 108, 40);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = GILT;
  ctx.lineWidth = 1;
  roundRectPath(ctx, 68, 68, W - 136, CARD_H - 136, 32);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";

  // ロゴ
  drawSugidama(ctx, CX, 150, 1.7, GILT);

  // 店名（和名・明朝）
  ctx.fillStyle = CREAM_2;
  ctx.font = `500 46px ${MINCHO}`;
  fillTextTracked(ctx, data.storeName, CX, 280, 5);

  // 欧文
  ctx.fillStyle = GILT;
  ctx.globalAlpha = 0.85;
  ctx.font = `500 21px ${MINCHO}`;
  fillTextTracked(ctx, "酒コレ ・ 酒神コレクション", CX, 320, 6);
  ctx.globalAlpha = 1;
  hairline(ctx, CX, 342, 220);

  // セクションラベル
  ctx.fillStyle = GILT;
  ctx.font = `500 24px ${MINCHO}`;
  fillTextTracked(ctx, data.heroLabel, CX, 396, 14);

  // ヒーロー（本日の一本・写真 or 瓶）4:5
  const hw = 330;
  const hh = 408;
  const hx = CX - hw / 2;
  const hy = 416;
  ctx.fillStyle = CREAM;
  roundRectPath(ctx, hx, hy, hw, hh, 24);
  ctx.fill();
  if (godArt) {
    // 酒神キャラを主役に＝レア度色の淡いステージ＋キャラ＋レア度フレーム/バッジ
    const fc = data.godFrameColor || GILT;
    ctx.save();
    roundRectPath(ctx, hx, hy, hw, hh, 24);
    ctx.clip();
    ctx.fillStyle = withAlpha(fc, 0.16);
    ctx.fillRect(hx, hy, hw, hh);
    ctx.restore();
    const pad = 30;
    const s = Math.min(hw - pad * 2, hh - pad * 2);
    drawImageCover(ctx, godArt, hx + (hw - s) / 2, hy + (hh - s) / 2, s, s, 20);
    ctx.strokeStyle = fc;
    ctx.lineWidth = 4;
    roundRectPath(ctx, hx, hy, hw, hh, 24);
    ctx.stroke();
    if (data.godRarityLabel) {
      ctx.font = `700 22px ${MINCHO}`;
      const bw = ctx.measureText(data.godRarityLabel).width + 28;
      ctx.fillStyle = fc;
      roundRectPath(ctx, hx + 16, hy + 16, bw, 40, 12);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(data.godRarityLabel, hx + 30, hy + 44);
      ctx.textAlign = "center";
    }
  } else {
    if (photo) {
      drawImageCover(ctx, photo, hx, hy, hw, hh, 24);
    } else {
      drawBottle(ctx, CX, hy + hh * 0.16, 118, data.featuredColor || "#2f5a43");
    }
    // 箔の枠
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    roundRectPath(ctx, hx, hy, hw, hh, 24);
    ctx.stroke();
  }

  // 銘柄名
  ctx.fillStyle = CREAM;
  fitCenteredText(ctx, data.featuredName, CX, hy + hh + 58, W - 180, 48, "500", MINCHO);

  // 補足（本日◯本 等）
  ctx.fillStyle = GILT;
  ctx.font = `400 25px ${MINCHO}`;
  ctx.textAlign = "center";
  ctx.fillText(data.subLine, CX, hy + hh + 98);

  // 区切り
  ctx.fillStyle = GILT;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(CX - 200, 958, 400, 1);
  ctx.globalAlpha = 1;

  // 集計行（コレクション種類数 ・ 位）
  const rowY = 994;
  ctx.strokeStyle = GILT;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX, rowY + 2);
  ctx.lineTo(CX, rowY + 84);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const leftX = CX - 185;
  ctx.fillStyle = CREAM;
  ctx.font = `400 80px ${SERIF_NUM}`;
  ctx.textAlign = "right";
  ctx.fillText(String(data.collectedKinds), leftX + 36, rowY + 70);
  ctx.fillStyle = CREAM;
  ctx.globalAlpha = 0.85;
  ctx.font = `500 30px ${MINCHO}`;
  ctx.textAlign = "left";
  ctx.fillText("種", leftX + 46, rowY + 66);
  ctx.globalAlpha = 1;
  ctx.fillStyle = GILT;
  ctx.font = `500 22px ${MINCHO}`;
  fillTextTracked(ctx, "図鑑コレクション", leftX, rowY + 100, 4);

  const rightX = CX + 185;
  ctx.fillStyle = CREAM;
  fitCenteredText(ctx, data.rankName, rightX, rowY + 58, 320, 40, "500", MINCHO);
  ctx.fillStyle = GILT;
  ctx.font = `500 22px ${MINCHO}`;
  fillTextTracked(ctx, "現在の位", rightX, rowY + 100, 4);

  // タグライン（代名詞）
  ctx.fillStyle = "#f5efe3";
  ctx.font = `500 46px ${MINCHO}`;
  fillTextTracked(ctx, "飲んだ日本酒が、図鑑になる。", CX, 1156, 3);
  ctx.fillStyle = GILT_HI;
  ctx.font = `400 27px ${MINCHO}`;
  fillTextTracked(ctx, "あなたの一杯も、ここから。", CX, 1198, 3);

  // フッター
  hairline(ctx, CX, 1232, 180);
  ctx.fillStyle = GILT;
  ctx.globalAlpha = 0.9;
  ctx.font = `400 22px ${ROMAN}`;
  fillTextTracked(ctx, `東京・常盤橋 ／ ${data.url}`, CX, 1264, 2);
  ctx.globalAlpha = 1;

  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像生成に失敗しました"))), "image/png");
  });
}
