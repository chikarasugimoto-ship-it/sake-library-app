// 神おろし演出用のcanvasパーティクルエンジン（SSR/UR/LRのみマウント）。
// 設計原則: プール固定512（生成/GCゼロ）・スプライトは起動時にオフスクリーンへ事前描画し
// 毎フレームは drawImage のみ・DPR上限2・dtクランプ・visibilitychangeで停止・unmountで破棄。
// 座標はすべて 0..1 の正規化（解像度非依存）。timeScale でスローモーション対応。

export type SpriteKind = "dust" | "leaf" | "ember" | "spark";

type Particle = {
  alive: boolean;
  kind: SpriteKind;
  x: number; y: number;       // 正規化座標
  vx: number; vy: number;     // 正規化速度/秒
  ax: number; ay: number;     // 加速度（重力・浮力）
  drag: number;               // 空気抵抗（1=なし）
  sway: number;               // sin横揺れの強さ
  swayFreq: number;
  swirl: number;              // 中心(cx,cy)まわりの旋回力（渦）
  cx: number; cy: number;     // 渦・放射の中心
  life: number; ttl: number;  // 秒
  size: number;               // px（DPR前）
  rot: number; vr: number;    // 回転（金箔用）
  seed: number;
};

type EmitterOpts = {
  kind: SpriteKind;
  rate: number;               // 個/秒
  x?: [number, number];       // 出現範囲（正規化）
  y?: [number, number];
  speed?: [number, number];   // 正規化/秒
  angle?: [number, number];   // rad（0=右、-PI/2=上）
  ttl?: [number, number];
  size?: [number, number];
  gravity?: number;           // +で落下、-で上昇
  drag?: number;
  sway?: number;
};

type BurstOpts = {
  kind: SpriteKind;
  count: number;
  x: number; y: number;       // 中心（正規化）
  speed?: [number, number];
  ttl?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  swirl?: number;             // >0 で渦巻き上昇/収束系
  angle?: [number, number];
};

type Bolt = { pts: { x: number; y: number }[]; born: number; ttl: number; width: number };

const POOL = 512;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// オーロラのリボン3本の縦グラデ色（下端透明→上端で発色）。リサイズ時に一度だけグラデを焼く。
const AURORA_COLORS: [string, string][] = [
  ["rgba(47,93,70,0)", "rgba(88,170,130,0.20)"],
  ["rgba(90,70,20,0)", "rgba(216,184,90,0.16)"],
  ["rgba(60,40,90,0)", "rgba(150,110,200,0.13)"],
];

export class RevealFx {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprites = new Map<SpriteKind, HTMLCanvasElement>();
  private pool: Particle[] = [];
  private emitters: (EmitterOpts & { acc: number })[] = [];
  private bolts: Bolt[] = [];
  private auroraOn = false;
  private auroraAlpha = 0;
  private auroraGrads: CanvasGradient[] = []; // リサイズ時に焼くオーロラ縦グラデ（毎フレーム生成を避ける）
  private raf = 0;
  private last = 0;
  private now = 0;             // エンジン内部時計（timeScale適用後・秒）
  private dpr = 1;
  private destroyed = false;
  private sleeping = false;   // 描くものが無く rAF を止めている状態
  timeScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    for (let i = 0; i < POOL; i++) {
      this.pool.push({ alive: false, kind: "dust", x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 1, sway: 0, swayFreq: 1, swirl: 0, cx: 0.5, cy: 0.45, life: 0, ttl: 1, size: 4, rot: 0, vr: 0, seed: Math.random() * 100 });
    }
    this.buildSprites();
    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVis);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private resize = () => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // オーロラのグラデは canvas 高さ依存なのでここで焼き直す（tick 内の毎フレーム生成を廃止）
    const H = this.canvas.height;
    this.auroraGrads = AURORA_COLORS.map(([c0, c1]) => {
      const g = this.ctx.createLinearGradient(0, H, 0, H * 0.12);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      return g;
    });
  };

  private onVis = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf); }
    else if (!this.sleeping && !this.destroyed) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  };

  // スプライトの事前描画（毎フレームのgradient生成を禁止するため）
  private buildSprites() {
    const mk = (size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const c = cv.getContext("2d")!;
      draw(c, size);
      return cv;
    };
    // 金粉: 柔らかいグロー玉
    this.sprites.set("dust", mk(32, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,244,214,0.95)");
      g.addColorStop(0.35, "rgba(232,209,160,0.55)");
      g.addColorStop(1, "rgba(232,209,160,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }));
    // 金箔: 小さな矩形フレーク（回転して舞う）
    this.sprites.set("leaf", mk(24, (c, s) => {
      const g = c.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, "#f2e2b8");
      g.addColorStop(0.5, "#d8b85a");
      g.addColorStop(1, "#a8842f");
      c.fillStyle = g;
      c.fillRect(s * 0.2, s * 0.32, s * 0.6, s * 0.36);
    }));
    // 火の粉: 暖色の小さな灯
    this.sprites.set("ember", mk(24, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,214,150,0.95)");
      g.addColorStop(0.4, "rgba(226,138,60,0.6)");
      g.addColorStop(1, "rgba(180,80,30,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }));
    // 火花: 鋭い点
    this.sprites.set("spark", mk(16, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,240,1)");
      g.addColorStop(0.5, "rgba(240,214,150,0.7)");
      g.addColorStop(1, "rgba(240,214,150,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }));
  }

  private alloc(): Particle | null {
    for (let i = 0; i < POOL; i++) if (!this.pool[i].alive) return this.pool[i];
    return null; // プール満杯なら黙って捨てる（上限保証）
  }

  private spawn(kind: SpriteKind, x: number, y: number, o: { speed?: [number, number]; angle?: [number, number]; ttl?: [number, number]; size?: [number, number]; gravity?: number; drag?: number; sway?: number; swirl?: number }) {
    const p = this.alloc();
    if (!p) return;
    const sp = rnd(...(o.speed || [0.02, 0.08]));
    const an = rnd(...(o.angle || [0, Math.PI * 2]));
    p.alive = true; p.kind = kind;
    p.x = x; p.y = y;
    p.vx = Math.cos(an) * sp; p.vy = Math.sin(an) * sp;
    p.ax = 0; p.ay = o.gravity ?? 0;
    p.drag = o.drag ?? 1;
    p.sway = o.sway ?? 0; p.swayFreq = rnd(0.6, 1.6);
    p.swirl = o.swirl ?? 0; p.cx = 0.5; p.cy = 0.42;
    p.life = 0; p.ttl = rnd(...(o.ttl || [1, 2]));
    p.size = rnd(...(o.size || [3, 7]));
    p.rot = Math.random() * Math.PI * 2; p.vr = kind === "leaf" ? rnd(-4, 4) : 0;
    p.seed = Math.random() * 100;
  }

  // アイドル休止から復帰（描くものが増えたとき rAF を再開）
  private wake() {
    if (this.sleeping && !this.destroyed) {
      this.sleeping = false;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** 常時エミッタを追加（idを返す） */
  addEmitter(o: EmitterOpts): number {
    this.emitters.push({ ...o, acc: 0 });
    this.wake();
    return this.emitters.length - 1;
  }
  clearEmitters() { this.emitters = []; }

  /** 単発バースト */
  burst(o: BurstOpts) {
    for (let i = 0; i < o.count; i++) {
      this.spawn(o.kind, o.x + rnd(-0.01, 0.01), o.y + rnd(-0.01, 0.01), {
        speed: o.speed || [0.08, 0.3],
        angle: o.angle,
        ttl: o.ttl || [0.8, 1.8],
        size: o.size,
        gravity: o.gravity ?? 0.05,
        drag: o.drag ?? 0.92,
        swirl: o.swirl ?? 0,
      });
    }
    this.wake();
  }

  /** 稲妻（中点変位ポリライン・寿命内で減衰） */
  bolt(x0: number, y0: number, x1: number, y1: number, width = 2, ttl = 0.14) {
    const pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    // 中点変位を4回
    for (let it = 0; it < 4; it++) {
      for (let i = pts.length - 1; i > 0; i--) {
        const a = pts[i - 1], b = pts[i];
        const mx = (a.x + b.x) / 2 + rnd(-0.035, 0.035) / (it + 1);
        const my = (a.y + b.y) / 2 + rnd(-0.02, 0.02) / (it + 1);
        pts.splice(i, 0, { x: mx, y: my });
      }
    }
    this.bolts.push({ pts, born: this.now, ttl, width });
    this.wake();
  }

  /** オーロラ（LR）: sin波で揺らぐ縦グラデのリボン3本 */
  setAurora(on: boolean) { this.auroraOn = on; if (on) this.wake(); }

  /** 全消去（スキップ用: パーティクル/ボルトを即時クリア、エミッタ停止） */
  clearAll() {
    this.emitters = [];
    this.bolts = [];
    this.auroraOn = false;
    for (const p of this.pool) p.alive = false;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  private tick = (t: number) => {
    if (this.destroyed) return;
    const dtRaw = Math.min(32, t - this.last) / 1000;
    this.last = t;
    const dt = dtRaw * this.timeScale;
    this.now += dt;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // オーロラ（加算・画面下から立ち上る3本のリボン）
    if (this.auroraOn || this.auroraAlpha > 0.005) {
      this.auroraAlpha += ((this.auroraOn ? 1 : 0) - this.auroraAlpha) * Math.min(1, dt * 1.2);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const phase = this.now * (0.25 + i * 0.08) + i * 2.1;
        const cx = W * (0.25 + i * 0.25 + Math.sin(phase) * 0.06);
        const w = W * (0.16 + 0.04 * Math.sin(phase * 1.7 + i));
        ctx.globalAlpha = this.auroraAlpha;
        ctx.fillStyle = this.auroraGrads[i];
        ctx.beginPath();
        // ゆらぐ帯（左右エッジをsinで揺らす・低ポリで軽く）
        const seg = 6;
        for (let s = 0; s <= seg; s++) {
          const yy = H - (H * 0.85 * s) / seg;
          const sway = Math.sin(phase + s * 0.9) * W * 0.05 * (s / seg);
          const xx = cx + sway - w / 2;
          if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        for (let s = seg; s >= 0; s--) {
          const yy = H - (H * 0.85 * s) / seg;
          const sway = Math.sin(phase + s * 0.9) * W * 0.05 * (s / seg);
          const xx = cx + sway + w / 2;
          ctx.lineTo(xx, yy);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // エミッタ
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(e.kind, rnd(...(e.x || [0.05, 0.95])), rnd(...(e.y || [0.9, 1.05])), {
          speed: e.speed || [0.02, 0.06],
          angle: e.angle || [-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4],
          ttl: e.ttl || [2.5, 4.5],
          size: e.size,
          gravity: e.gravity ?? -0.004,
          drag: e.drag ?? 1,
          sway: e.sway ?? 0.02,
        });
      }
    }

    // パーティクル
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.ttl) { p.alive = false; continue; }
      if (p.swirl !== 0) {
        // 渦: 中心まわりの接線方向へ加速しつつ僅かに外へ
        const dx = p.x - p.cx, dy = (p.y - p.cy) * 1.4;
        p.vx += (-dy) * p.swirl * dt;
        p.vy += (dx) * p.swirl * dt * 0.9 - 0.06 * dt; // 上昇成分
      }
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      const dr = Math.pow(p.drag, dt * 60);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt + (p.sway ? Math.sin(this.now * p.swayFreq * 2 + p.seed) * p.sway * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }

    // 描画（加算系→通常系の順）
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (!p.alive) continue;
      const sp = this.sprites.get(p.kind)!;
      const k = p.life / p.ttl;
      // フェードイン0.1・フェードアウト後半
      const a = Math.min(1, k / 0.1) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
      ctx.globalAlpha = Math.max(0, a);
      const s = p.size * this.dpr;
      const x = p.x * W, y = p.y * H;
      if (p.kind === "leaf") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        // 回転で厚みが変わって見えるようscaleYを揺らす（金箔のきらめき）
        ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.rot * 1.7 + p.seed)));
        ctx.drawImage(sp, -s, -s, s * 2, s * 2);
        ctx.restore();
      } else {
        ctx.drawImage(sp, x - s, y - s, s * 2, s * 2);
      }
    }

    // 稲妻（直前のパーティクル描画で残った globalAlpha を引き継がないようリセット）
    if (this.bolts.length) {
      ctx.globalAlpha = 1;
      const alive: Bolt[] = [];
      for (const b of this.bolts) {
        const k = (this.now - b.born) / b.ttl;
        if (k >= 1) continue;
        alive.push(b);
        const alpha = 1 - k;
        // グロー（金）→芯（白）の2パス
        for (const pass of [0, 1] as const) {
          ctx.beginPath();
          for (let i = 0; i < b.pts.length; i++) {
            const px = b.pts[i].x * W, py = b.pts[i].y * H;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          if (pass === 0) {
            ctx.strokeStyle = `rgba(216,184,90,${0.45 * alpha})`;
            ctx.lineWidth = b.width * 3 * this.dpr;
          } else {
            ctx.strokeStyle = `rgba(255,255,245,${0.9 * alpha})`;
            ctx.lineWidth = b.width * this.dpr;
          }
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      }
      this.bolts = alive;
    }
    ctx.restore();
    // アイドル休止: 描くものが何も無ければ rAF を止める（スキップ後や自然消滅後の空回り防止）。
    // 直前の clearRect 済みなので画面は空。addEmitter/burst/bolt/setAurora(true) で復帰する。
    let anyAlive = false;
    for (let i = 0; i < POOL; i++) { if (this.pool[i].alive) { anyAlive = true; break; } }
    if (!this.emitters.length && !this.bolts.length && !this.auroraOn && this.auroraAlpha <= 0.005 && !anyAlive) {
      this.auroraAlpha = 0;
      this.sleeping = true;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
