// Turso Platform API で本番DBを作成し、URL とトークンを .turso.env に書き出す。
// 使い方: node scripts/provision-turso.mjs <APIトークンを書いたファイルパス>
// 生成物 .turso.env は .gitignore 済み。チャットにキーを残さない運用。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokenFile = process.argv[2];
if (!tokenFile || !fs.existsSync(tokenFile)) {
  console.error("APIトークンのファイルパスを渡してください: node scripts/provision-turso.mjs <path>");
  process.exit(1);
}
const apiToken = fs.readFileSync(tokenFile, "utf8").trim();
const DB_NAME = process.env.TURSO_DB_NAME || "sake-library";

const api = async (method, urlPath, body) => {
  const res = await fetch("https://api.turso.tech" + urlPath, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}: ${text}`);
  return json;
};

// 1. 組織を特定
const orgs = await api("GET", "/v1/organizations");
if (!Array.isArray(orgs) || orgs.length === 0) throw new Error("組織が見つかりません");
const org = orgs[0].slug || orgs[0].name;
console.log("組織:", org);

// 2. グループを特定（無ければ default を作る）
let groups = await api("GET", `/v1/organizations/${org}/groups`).catch(() => ({ groups: [] }));
let groupList = groups.groups || groups || [];
let group = groupList[0]?.name;
if (!group) {
  console.log("グループが無いので default を作成します…");
  const loc = process.env.TURSO_LOCATION || "nrt"; // 東京
  const created = await api("POST", `/v1/organizations/${org}/groups`, { name: "default", location: loc });
  group = created.group?.name || "default";
}
console.log("グループ:", group);

// 3. DB作成（既存ならそれを使う）
let hostname;
try {
  const created = await api("POST", `/v1/organizations/${org}/databases`, { name: DB_NAME, group });
  hostname = created.database?.Hostname || created.database?.hostname;
  console.log("DB作成:", DB_NAME);
} catch (e) {
  if (String(e).includes("already exists") || String(e).includes("409")) {
    const got = await api("GET", `/v1/organizations/${org}/databases/${DB_NAME}`);
    hostname = got.database?.Hostname || got.database?.hostname;
    console.log("既存DBを使用:", DB_NAME);
  } else throw e;
}
if (!hostname) throw new Error("Hostname を取得できませんでした");

// 4. DBトークン発行
const tok = await api("POST", `/v1/organizations/${org}/databases/${DB_NAME}/auth/tokens`, {});
const dbToken = tok.jwt || tok.token;
if (!dbToken) throw new Error("DBトークンを取得できませんでした");

// 5. .turso.env に書き出し
const url = `libsql://${hostname}`;
const out = path.join(root, ".turso.env");
fs.writeFileSync(out, `TURSO_DATABASE_URL=${url}\nTURSO_AUTH_TOKEN=${dbToken}\n`, "utf8");
console.log("書き出し完了 →", out);
console.log("DATABASE_URL:", url);
