// 掲載写真の生成（ブラウザ専用・Canvas）。撮影者ごとのバラつきを吸収して
// 「瓶が中央・同じ大きさ・整った明るさ・統一の白背景」に揃える。
// /admin/new（新規登録）と在庫ボードの「写真を撮り直す」で共用。

export type Bbox = { x: number; y: number; w: number; h: number };

const TW = 800, TH = 1000; // 掲載用 4:5 縦
const FILL = "#ffffff";     // 掲載写真の背景は白で統一

// AI認識用に長辺900pxへ縮小したJPEG（通信を軽くする）
export function resizeForAI(bitmap: ImageBitmap): { base64: string; preview: string } {
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { base64: dataUrl.split(",")[1], preview: dataUrl };
}

// 瓶の枠（AIのbbox）で寄りを揃え→明るさ補正→背景を切り抜いて白背景に合成。
// 切り抜きに失敗した場合も、ラベルが切れないよう contain（全体を収める）で白背景に置く。
export async function buildDisplayPhoto(
  bitmap: ImageBitmap,
  bbox: Bbox,
  rarity = "R"
): Promise<{ base64: string; preview: string; removed: boolean }> {
  // 1. 瓶の枠（+余白10%）を作業用キャンバスに切り出し、明るさ補正
  const pad = 0.1;
  const cx = (bbox.x + bbox.w / 2) * bitmap.width;
  const cy = (bbox.y + bbox.h / 2) * bitmap.height;
  const sw = Math.min(bitmap.width, bbox.w * (1 + pad * 2) * bitmap.width);
  const sh = Math.min(bitmap.height, bbox.h * (1 + pad * 2) * bitmap.height);
  const sx = Math.max(0, Math.min(cx - sw / 2, bitmap.width - sw));
  const sy = Math.max(0, Math.min(cy - sh / 2, bitmap.height - sh));
  const wscale = Math.min(1, 1000 / sh);
  const wc = document.createElement("canvas");
  wc.width = Math.round(sw * wscale);
  wc.height = Math.round(sh * wscale);
  const wctx = wc.getContext("2d")!;
  wctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, wc.width, wc.height);
  autoLevels(wctx, wc.width, wc.height);

  // 2. 背景切り抜き → 白背景に合成
  try {
    const blob = await new Promise<Blob>((res, rej) =>
      wc.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), "image/jpeg", 0.92)
    );
    const { removeBackground } = await import("@imgly/background-removal");
    const cut = await removeBackground(blob, { output: { format: "image/png" } });
    const cutBmp = await createImageBitmap(cut);
    return { ...composeOnGod(cutBmp, rarity), removed: true };
  } catch {
    // フォールバック：切り抜けなくても、ラベルが切れないよう contain で白背景に収める
    const out = document.createElement("canvas");
    out.width = TW;
    out.height = TH;
    const octx = out.getContext("2d")!;
    octx.fillStyle = FILL;
    octx.fillRect(0, 0, TW, TH);
    const scale = Math.min((TW * 0.92) / wc.width, (TH * 0.92) / wc.height); // contain（全体を収める）
    const dw = wc.width * scale, dh = wc.height * scale;
    octx.drawImage(wc, (TW - dw) / 2, (TH - dh) / 2, dw, dh);
    const u = out.toDataURL("image/jpeg", 0.85);
    return { base64: u.split(",")[1], preview: u, removed: false };
  }
}

// 背景ステージの色（以前は酒神レア度で色分けしていた名残。いまは既定の R だけ使う）（中心は明るく瓶が映える／中間＝レア度の色／外側＝深い同系色）。
// N・R=緑、SR=銅、SSR=金、UR=藍紫、LR=黒×金。glow＝上部の後光、shadow＝瓶の影色。
const STAGE: Record<string, { mid: string; edge: string; glow: string; shadow: string }> = {
  N:   { mid: "#6b8a78", edge: "#314d3e", glow: "rgba(200,205,196,0.20)", shadow: "rgba(12,28,20,0.36)" },
  R:   { mid: "#5f8770", edge: "#1e3d2f", glow: "rgba(170,205,180,0.24)", shadow: "rgba(8,26,18,0.40)" },
  SR:  { mid: "#a07b44", edge: "#46331b", glow: "rgba(214,170,108,0.36)", shadow: "rgba(40,26,10,0.40)" },
  SSR: { mid: "#bd9740", edge: "#3c2d12", glow: "rgba(232,209,160,0.44)", shadow: "rgba(40,28,8,0.42)" },
  UR:  { mid: "#6e5ea8", edge: "#241d44", glow: "rgba(224,192,124,0.40)", shadow: "rgba(20,14,40,0.44)" },
  LR:  { mid: "#2b2733", edge: "#0d0d12", glow: "rgba(255,226,140,0.46)", shadow: "rgba(0,0,0,0.5)" },
};

// 切り抜き画像の「中身（非透明＝瓶＋ラベル）」の範囲を測る。外側の透明な余白を無視して
// 瓶を最大化するために使う（再加工した既存写真でもラベルが小さいままにならない）。
function alphaBounds(bmp: ImageBitmap): { sx: number; sy: number; sw: number; sh: number } {
  const w = bmp.width, h = bmp.height;
  const full = { sx: 0, sy: 0, sw: w, sh: h };
  try {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d")!;
    cx.drawImage(bmp, 0, 0);
    const data = cx.getImageData(0, 0, w, h).data;
    const A = 24; // これ未満のアルファは「余白」とみなす
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > A) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return full; // 中身が見つからなければ全体
    // ほんの少しだけ余白を足す（切れ防止）
    const padX = (maxX - minX) * 0.03, padY = (maxY - minY) * 0.03;
    const sx = Math.max(0, minX - padX), sy = Math.max(0, minY - padY);
    return {
      sx,
      sy,
      sw: Math.min(w - sx, maxX - minX + 1 + padX * 2),
      sh: Math.min(h - sy, maxY - minY + 1 + padY * 2),
    };
  } catch {
    return full; // getImageData が使えない（タイント等）ときは全体を使う
  }
}

// 切り抜いた瓶を深緑の背景に合成。中心は明るくラベルが映える。
function composeOnGod(cutBmp: ImageBitmap, rarity: string): { base64: string; preview: string } {
  const st = STAGE[rarity] || STAGE.R;
  const c = document.createElement("canvas");
  c.width = TW;
  c.height = TH;
  const ctx = c.getContext("2d")!;
  // レア度色のステージ（中心クリーム→中間レア色→外側 深いレア色）
  const g = ctx.createRadialGradient(TW / 2, TH * 0.40, TW * 0.14, TW / 2, TH * 0.56, TH * 1.02);
  g.addColorStop(0, "#f5f2ea");
  g.addColorStop(0.5, st.mid);
  g.addColorStop(1, st.edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TW, TH);
  // LR（伝説）＝レインボーの後光。中心は透明＝ラベルが映える・瓶のまわりに虹のリング。
  if (rarity === "LR") {
    try {
      const rc = document.createElement("canvas");
      rc.width = TW; rc.height = TH;
      const rctx = rc.getContext("2d")!;
      const cg = (rctx as unknown as { createConicGradient: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient(-Math.PI / 2, TW / 2, TH * 0.46);
      const hues = ["#ff5a5a", "#ffae3d", "#ffe34d", "#5fe39a", "#54c8ff", "#9b7bff", "#ff5a5a"];
      hues.forEach((h, i) => cg.addColorStop(i / (hues.length - 1), h));
      rctx.fillStyle = cg;
      rctx.fillRect(0, 0, TW, TH);
      // リング状にマスク（中心透明→中ほど虹→外側フェード）
      rctx.globalCompositeOperation = "destination-in";
      const ring = rctx.createRadialGradient(TW / 2, TH * 0.46, TW * 0.30, TW / 2, TH * 0.46, TW * 0.95);
      ring.addColorStop(0, "rgba(0,0,0,0)");
      ring.addColorStop(0.5, "rgba(0,0,0,1)");
      ring.addColorStop(1, "rgba(0,0,0,0)");
      rctx.fillStyle = ring;
      rctx.fillRect(0, 0, TW, TH);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.drawImage(rc, 0, 0);
      ctx.restore();
    } catch {
      // createConicGradient 非対応端末では黒×金のみ（後光は下で描く）
    }
  }
  // 上部の後光（レア度ごとの色味）
  const glow = ctx.createRadialGradient(TW / 2, TH * 0.13, 0, TW / 2, TH * 0.13, TW * 0.8);
  glow.addColorStop(0, st.glow);
  glow.addColorStop(1, "rgba(202,168,106,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TW, TH);
  // 瓶（ラベル）を主役として大きく中央に置く。切り抜きの貼り付け感が残ってOK。
  // 重要: 入力（特に既存写真の再加工）は切り抜き後も外側に透明の余白が残るため、枠全体を縮めると瓶が小さいまま。
  // そこで「中身（非透明＝瓶＋ラベル）の範囲」を測ってトリミングし、それを 98%/96% で中央に最大配置する＝ラベルが必ず大きくなる。
  const b = alphaBounds(cutBmp);
  const fit = Math.min((TW * 0.98) / b.sw, (TH * 0.96) / b.sh);
  const dw = b.sw * fit, dh = b.sh * fit;
  const x = (TW - dw) / 2;
  const y = (TH - dh) / 2; // 上下中央。背景ステージの中心に主役を大きく。
  ctx.drawImage(cutBmp, b.sx, b.sy, b.sw, b.sh, x, y, dw, dh);
  const u = c.toDataURL("image/jpeg", 0.9);
  return { base64: u.split(",")[1], preview: u };
}

// 軽い自動レベル補正（暗い/明るい/色かぶりをならす）。輝度1%〜99%を0〜255へ伸長
function autoLevels(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    hist[l]++;
  }
  const total = w * h;
  const cut = total * 0.01;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
  if (hi - lo < 24) return; // コントラストが既に十分／極端な補正は避ける
  const range = hi - lo;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i + 1] = Math.max(0, Math.min(255, ((d[i + 1] - lo) * 255) / range));
    d[i + 2] = Math.max(0, Math.min(255, ((d[i + 2] - lo) * 255) / range));
  }
  ctx.putImageData(img, 0, 0);
}
