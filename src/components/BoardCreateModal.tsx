import { useState } from "react";
import { X } from "lucide-react";
import { createBoard, type BoardType, type BoardAllowWrite } from "@/lib/store";

export function BoardCreateModal({ onClose }: { onClose: (created?: boolean) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<BoardType>("list");
  const [allowWrite, setAllowWrite] = useState<BoardAllowWrite>("admin");
  const [team, setTeam] = useState("both");
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setErr("게시판 이름을 입력해주세요"); return; }
    setBusy(true);
    setErr("");
    try {
      await createBoard({ name: name.trim(), type, allowWrite, team, secret });
      onClose(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
      onClick={() => onClose()}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-80 rounded-2xl bg-card border border-border shadow-2xl p-5 animate-in zoom-in-95"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-base">게시판 추가</h2>
          <button onClick={() => onClose()} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 게시판 이름 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">게시판 이름 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 공지사항"
              className="w-full h-9 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
              autoFocus
            />
          </div>

          {/* UI 타입 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">게시판 형태</label>
            <div className="flex gap-3">
              {([["list", "📋 리스트형"], ["card", "🗞️ 카드형"]] as [BoardType, string][]).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="type" checked={type === val} onChange={() => setType(val)} className="accent-brand" />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 쓰기 권한 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">글쓰기 권한</label>
            <div className="flex gap-3">
              {([["admin", "관리자만"], ["all", "전체 사용자"]] as [BoardAllowWrite, string][]).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="allowWrite" checked={allowWrite === val} onChange={() => setAllowWrite(val)} className="accent-brand" />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 공개 범위 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">공개 범위</label>
            <select
              value={team}
              onChange={e => setTeam(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
            >
              <option value="both">전체 팀 공통</option>
              <option value="sales">영업팀만</option>
              <option value="eng">엔지니어팀만</option>
            </select>
          </div>

          {/* 비밀 게시판 토글 */}
          <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-lg border border-dashed border-border hover:bg-accent/40 transition">
            <input
              type="checkbox"
              checked={secret}
              onChange={e => setSecret(e.target.checked)}
              className="accent-brand w-4 h-4"
            />
            <div>
              <div className="text-sm font-medium flex items-center gap-1.5">
                🔒 비밀 게시판
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                이스터에그로 잠금 해제한 사용자만 접근 가능
              </div>
            </div>
          </label>

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <button
          onClick={handleCreate}
          disabled={busy}
          className="w-full h-10 mt-5 rounded-xl gradient-brand text-primary-foreground font-semibold text-sm hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? "생성 중..." : "게시판 만들기"}
        </button>
      </div>
    </div>
  );
}
