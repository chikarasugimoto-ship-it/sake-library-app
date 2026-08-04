// 初期データ投入（実運用前のデモ用。何度実行しても重複しない）
import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const client = process.env.TURSO_DATABASE_URL
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: "file:" + path.join(dataDir, "sake-library.db").replace(/\\/g, "/") });

const SAKES = [
  {
    brand: "而今", sub_name: "", brewery: "木屋正酒造", prefecture: "三重県", grade: "純米吟醸",
    price: 1200, description: "ジューシーな果実味と上品な甘み、きれいな余韻。入手困難な人気銘柄です。煮干しの旨味を引き立てる酸があり、炙りチャーシューの脂と合わせると真価を発揮します。",
    taste_tags: ["フルーティ", "華やか"], pairings: ["炙りチャーシューに合う", "日本酒初心者向け"],
    taste_chart: { sweet: 4, acid: 3, aroma: 5, sharp: 2 }, label_color: "#1e3d2f", status: "low",
  },
  {
    brand: "新政 No.6", sub_name: "S-type", brewery: "新政酒造", prefecture: "秋田県", grade: "純米",
    price: 1400, description: "生酛づくりのやわらかな酸と微発泡感。ワインのように軽やかで、日本酒がはじめての方にこそ飲んでほしい一本。冷たいまま、最初の一杯にどうぞ。",
    taste_tags: ["酸味", "初心者向け"], pairings: ["日本酒初心者向け", "食中酒に"],
    taste_chart: { sweet: 3, acid: 5, aroma: 4, sharp: 3 }, label_color: "#7a5a2e", status: "available",
  },
  {
    brand: "獺祭 磨き二割三分", sub_name: "", brewery: "旭酒造", prefecture: "山口県", grade: "純米大吟醸",
    price: 2800, description: "山田錦を23%まで磨いた、華やかさの極み。蜂蜜のような香りと透明感のある甘みが静かに広がります。特別な日の一杯に、ゆっくりと。",
    taste_tags: ["華やか", "甘口"], pairings: ["デザート酒に", "日本酒初心者向け"],
    taste_chart: { sweet: 5, acid: 2, aroma: 5, sharp: 2 }, label_color: "#23303c", status: "available",
  },
  {
    brand: "田酒", sub_name: "特別純米", brewery: "西田酒造店", prefecture: "青森県", grade: "特別純米",
    price: 980, description: "米の旨味がまっすぐ伝わる正統派。派手さはないのに、杯が止まらない。煮干しラーメンのスープと合わせると、旨味が二重になります。",
    taste_tags: ["旨口", "濃厚"], pairings: ["煮干しラーメンに合う", "食中酒に"],
    taste_chart: { sweet: 3, acid: 2, aroma: 2, sharp: 4 }, label_color: "#2c3a52", status: "available",
  },
  {
    brand: "十四代 本丸", sub_name: "秘伝玉返し", brewery: "高木酒造", prefecture: "山形県", grade: "特別本醸造",
    price: 1800, description: "「幻」と呼ばれる山形の銘酒。ふくよかな甘みと、するりと消えるキレ。出会えた日が、運の良い日です。",
    taste_tags: ["甘口", "華やか"], pairings: ["食中酒に"],
    taste_chart: { sweet: 5, acid: 2, aroma: 4, sharp: 3 }, label_color: "#5c5046", status: "soldout",
  },
  {
    brand: "風の森", sub_name: "ALPHA1", brewery: "油長酒造", prefecture: "奈良県", grade: "純米",
    price: 900, description: "シュワッと微発泡、グレープフルーツのような爽やかさ。アルコール度数も低めで、暑い日の一杯目に最高です。",
    taste_tags: ["微発泡", "初心者向け", "スッキリ"], pairings: ["和え玉に合う", "日本酒初心者向け"],
    taste_chart: { sweet: 3, acid: 4, aroma: 4, sharp: 4 }, label_color: "#7d3b32", status: "available", season_label: "夏限定",
  },
  {
    brand: "鍋島", sub_name: "隠し酒", brewery: "富久千代酒造", prefecture: "佐賀県", grade: "純米吟醸",
    price: 1500, description: "今日の隠し酒。スタッフに「アプリ見ました」とお声がけください。",
    taste_tags: ["フルーティ"], pairings: ["食中酒に"],
    taste_chart: { sweet: 4, acid: 3, aroma: 4, sharp: 3 }, label_color: "#314538", status: "available", is_hidden: 1,
  },
];

// スキーマはアプリ起動時にも作られるが、シード単体実行に備えてここでも作る
await client.execute(`CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL DEFAULT 'sugidama',
  name TEXT NOT NULL DEFAULT '煮干しと日本酒 すぎだま',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await client.execute(`CREATE TABLE IF NOT EXISTS sakes (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL DEFAULT 1,
  brand TEXT NOT NULL,
  sub_name TEXT DEFAULT '',
  brewery TEXT DEFAULT '',
  prefecture TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  price INTEGER,
  volume TEXT DEFAULT '90ml',
  description TEXT DEFAULT '',
  taste_tags TEXT DEFAULT '[]',
  pairings TEXT DEFAULT '[]',
  taste_chart TEXT DEFAULT '{}',
  season_label TEXT DEFAULT '',
  is_hidden INTEGER DEFAULT 0,
  photo BLOB,
  photo_type TEXT DEFAULT '',
  label_color TEXT DEFAULT '#1e3d2f',
  status TEXT NOT NULL DEFAULT 'available',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await client.execute(
  "INSERT INTO stores (id, slug, name) SELECT 1, 'sugidama', '煮干しと日本酒 すぎだま' WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 1)"
);

const existing = await client.execute("SELECT COUNT(*) AS n FROM sakes");
if (Number(existing.rows[0].n) > 0) {
  console.log(`既に ${existing.rows[0].n}件あるためシードをスキップしました`);
  process.exit(0);
}

let order = 1;
for (const s of SAKES) {
  await client.execute({
    sql: `INSERT INTO sakes
      (store_id, brand, sub_name, brewery, prefecture, grade, price, volume, description,
       taste_tags, pairings, taste_chart, season_label, is_hidden, label_color, status, sort_order)
     VALUES (1, ?, ?, ?, ?, ?, ?, '90ml', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      s.brand, s.sub_name, s.brewery, s.prefecture, s.grade, s.price, s.description,
      JSON.stringify(s.taste_tags), JSON.stringify(s.pairings), JSON.stringify(s.taste_chart),
      s.season_label ?? "", s.is_hidden ?? 0, s.label_color, s.status, order++,
    ],
  });
}
console.log(`${SAKES.length}件の日本酒を投入しました`);
