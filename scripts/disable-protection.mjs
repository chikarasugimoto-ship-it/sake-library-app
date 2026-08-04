// Vercelのデプロイ保護（Vercel Authentication / Password）を無効化する。
// 使い方: node scripts/disable-protection.mjs <Vercelトークンを書いたファイルパス>
import fs from "fs";

const tokenFile = process.argv[2];
if (!tokenFile || !fs.existsSync(tokenFile)) {
  console.error("Vercelトークンのファイルパスを渡してください");
  process.exit(1);
}
const token = fs.readFileSync(tokenFile, "utf8").trim();
const PROJECT = "prj_oS4Ciuedoi1T1j5QLETcRclFR7bE";
const TEAM = "team_6RwO2ADK9jW0cuTIk27TXRAR";

const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT}?teamId=${TEAM}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
});
const text = await res.text();
if (!res.ok) {
  console.error("失敗:", res.status, text);
  process.exit(1);
}
const j = JSON.parse(text);
console.log("OK: ssoProtection =", JSON.stringify(j.ssoProtection), "/ passwordProtection =", JSON.stringify(j.passwordProtection));
