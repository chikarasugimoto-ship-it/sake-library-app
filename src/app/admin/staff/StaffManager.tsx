"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Staff = { id: number; name: string; role: string; last_login: string };

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [newName, setNewName] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/staff", { cache: "no-store" });
    const j = await res.json();
    if (res.ok) setStaff(j.staff || []);
  }
  useEffect(() => { load(); }, []);

  async function call(method: string, body: object, okMsg: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/staff", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(j.error || "失敗しました");
      else { setMsg(okMsg); await load(); }
    } catch { setMsg("通信に失敗しました"); }
    setBusy(false);
  }

  async function add() {
    if (!newName.trim() || newPw.length < 4) { setMsg("名前とパスワード(4文字以上)を入れてください"); return; }
    await call("POST", { name: newName.trim(), password: newPw }, `${newName} を追加しました`);
    setNewName(""); setNewPw("");
  }
  function resetPw(s: Staff) {
    const pw = window.prompt(`${s.name} さんの新しいパスワードを入力（4文字以上）`);
    if (pw == null) return;
    if (pw.length < 4) { setMsg("パスワードは4文字以上にしてください"); return; }
    call("PATCH", { id: s.id, password: pw }, `${s.name} のパスワードを変更しました`);
  }
  function toggleRole(s: Staff) {
    const next = s.role === "admin" ? "staff" : "admin";
    if (!window.confirm(`${s.name} を${next === "admin" ? "管理者" : "一般スタッフ"}に変更しますか？`)) return;
    call("PATCH", { id: s.id, role: next }, `${s.name} の権限を変更しました`);
  }
  function del(s: Staff) {
    if (!window.confirm(`${s.name} を削除しますか？（元に戻せません）`)) return;
    call("DELETE", { id: s.id }, `${s.name} を削除しました`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 pb-24 pt-12">
      <Link href="/admin" className="text-xs text-ink-soft">‹ 在庫ボードへ戻る</Link>
      <h1 className="mt-2 text-2xl font-bold">スタッフ管理</h1>
      <p className="mt-1 text-xs text-ink-soft">追加・パスワード初期化・権限変更・削除（管理者のみ）。</p>

      {msg && <p className="mt-3 rounded-xl bg-[#eef3ef] px-3 py-2 text-[12px] text-moss-deep">{msg}</p>}

      <div className="mt-5 space-y-2.5">
        {staff.map((s) => (
          <div key={s.id} className="rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[15px] font-bold">
                  {s.name}
                  {s.role === "admin" && <span className="ml-2 rounded-full bg-gilt-bg px-2 py-0.5 text-[10px] font-bold text-gilt">管理者</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-soft">{s.last_login ? `最終ログイン ${s.last_login}` : "未ログイン"}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => resetPw(s)} className="rounded-full border border-moss px-3 py-1.5 text-[11.5px] font-bold text-moss disabled:opacity-50">パスワード初期化</button>
              <button disabled={busy} onClick={() => toggleRole(s)} className="rounded-full border border-hairline px-3 py-1.5 text-[11.5px] text-ink-soft disabled:opacity-50">
                {s.role === "admin" ? "一般にする" : "管理者にする"}
              </button>
              <button disabled={busy} onClick={() => del(s)} className="rounded-full border border-hairline px-3 py-1.5 text-[11.5px] text-[#b04a3a] disabled:opacity-50">削除</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-hairline p-4">
        <p className="text-sm font-bold">スタッフを追加</p>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="名前" className="mt-2 w-full rounded-xl border border-hairline bg-card px-3.5 py-2.5 text-sm outline-none" />
        <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="初期パスワード（4文字以上）" className="mt-2 w-full rounded-xl border border-hairline bg-card px-3.5 py-2.5 text-sm outline-none" />
        <button disabled={busy} onClick={add} className="mt-3 w-full rounded-full bg-moss-deep py-3 text-sm font-bold text-white disabled:opacity-50">追加する</button>
      </div>
    </main>
  );
}
