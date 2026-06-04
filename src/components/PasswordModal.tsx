import { useState } from "react";
import { X, KeyRound } from "lucide-react";
import { API_BASE, getPassword } from "@/lib/store";

export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");

    if (newPassword !== confirmPassword) {
      setErr("사용할 수 없는 비밀번호입니다. 다른 비밀번호를 입력해주세요.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-password": getPassword(),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        setErr("사용할 수 없는 비밀번호입니다. 다른 비밀번호를 입력해주세요.");
        return;
      }

      setSuccess(true);
    } catch {
      setErr("사용할 수 없는 비밀번호입니다. 다른 비밀번호를 입력해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand" />
            <h2 className="text-lg font-bold">비밀번호 변경</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-4">
            <p className="text-sm text-brand font-semibold mb-1">비밀번호가 변경되었습니다.</p>
            <p className="text-xs text-muted-foreground mb-5">다음 로그인 시 새 비밀번호를 사용하세요.</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full h-11 rounded-lg gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition"
            >
              확인
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
                현재 비밀번호
              </span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="현재 비밀번호 입력"
                className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
                새 비밀번호
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호 입력"
                className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
                새 비밀번호 확인
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="새 비밀번호 재입력"
                className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition text-sm"
              />
            </label>

            {err && (
              <p className="text-xs text-destructive">{err}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-lg border border-border hover:bg-accent transition text-sm"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
                className="flex-1 h-11 rounded-lg gradient-brand text-primary-foreground font-semibold disabled:opacity-50 hover:opacity-90 active:scale-[.98] transition text-sm"
              >
                {busy ? "변경 중..." : "변경"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}