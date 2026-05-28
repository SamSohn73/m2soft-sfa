import { useState } from "react";
import { X, KeyRound } from "lucide-react";

export function PasswordModal({ onClose }: { onClose: () => void }) {
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

        <p className="text-sm text-muted-foreground leading-relaxed">
          팀별 비밀번호는 백엔드 서버의 환경변수
          <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-foreground">APP_PASSWORD_SALES</code>
          (영업팀)와
          <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-foreground">APP_PASSWORD_ENG</code>
          (엔지니어팀)로 관리됩니다.
          <br />
          변경하려면 서버 PC에서 환경변수를 수정한 뒤 백엔드를 재시작하세요.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full h-11 rounded-lg gradient-brand text-primary-foreground font-semibold hover:opacity-90 active:scale-[.98] transition"
        >
          확인
        </button>
      </div>
    </div>
  );
}
