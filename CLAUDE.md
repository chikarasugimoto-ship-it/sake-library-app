# sake-library-app（酒蔵書アプリ）で作業するときの手順書

（このファイルは 2026-10-07 に作成。リポ固有の注意は気づいたら足す）

## デプロイ（2026-10-07 から。これが正）

Vercel は GitHub の `main` につながっていて、**`main` に入れると自動で本番に出る**（2026-10-07 に全プロジェクトで確認）。
杉本さんが「デプロイ」「デプロイして」と言ったら、作業ブランチを `main` に入れる:

```bash
git fetch origin main && git merge --no-edit origin/main && git push origin HEAD:main
```

- この操作は `.claude/settings.json` で許可されている（杉本さんが 2026-10-06 に設定）。**言われる前に `main` には入れない**
- クラウドの Claude（claude.ai/code）からは Vercel に接続できないので、`npx vercel --prod` は**使わない・案内しない**。
  push すれば出る。出たかどうかは杉本さんに Vercel の Deployments（https://vercel.com/sugimoto-projects1）で見てもらう
- すでに `main` に入っている変更は、もう本番に出ている（あらためて何かする必要はない）
- 杉本さんのPC（`~/.claude/CLAUDE.md`）にある共通ルールは、クラウドのセッションでは読まれない。このファイルが頼り
- デプロイしても**開いている iPad は自動で更新されない**。端末側でリロードが要る
