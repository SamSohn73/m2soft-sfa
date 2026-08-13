import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Viewer } from "@/components/Viewer";
import { UploadModal } from "@/components/UploadModal";
import { PasswordModal } from "@/components/PasswordModal";
import { getPresentations, isAuthed, type Presentation } from "@/lib/store";
import { Menu, PanelLeftOpen } from "lucide-react";
import { BoardList } from "@/components/BoardList";
import { BoardCard } from "@/components/BoardCard";
import type { Board } from "@/lib/store";
import { buildViewerUrl } from "@/lib/viewer";

export const Route = createFileRoute("/main")({
  head: () => ({
    meta: [
      { title: "M2Soft SFA Project" },
      { name: "description", content: "To be M2Soft SFA Project" },
    ],
  }),
  component: MainPage,
});

function MainPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Presentation | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string | undefined>(undefined);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(290);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [secretUnlocked, setSecretUnlocked] = useState(false);

  // ── 이스터에그 A: 코나미 코드 ↑↓↑↓↑↑↑↑↓ ──────────────
  const KONAMI = ["ArrowUp","ArrowDown","ArrowUp","ArrowDown","ArrowUp","ArrowUp","ArrowUp","ArrowUp","ArrowDown"];
  const konamiRef = useRef<string[]>([]);


  const unlockSecret = () => {
    setSecretUnlocked(true);
    // 잠금 해제 효과
    const msg = document.createElement("div");
    msg.textContent = "🔓 비밀 게시판 잠금 해제!";
    msg.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2E5E4E;color:white;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;animation:fadeIn .3s ease;pointer-events:none";
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 2000);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      konamiRef.current.push(e.key);
      if (konamiRef.current.length > KONAMI.length) {
        konamiRef.current.shift();
      }
      if (JSON.stringify(konamiRef.current) === JSON.stringify(KONAMI)) {
        konamiRef.current = [];
        unlockSecret();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);


  // 스와이프 감지용
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthed()) navigate({ to: "/" });
  }, [navigate]);

  useEffect(() => {
    if (!selected) return;
    const refresh = () => {
      getPresentations()
        .then((list) => {
          const found = list.find((p) => p.id === selected.id);
          setSelected(found ?? null);
        })
        .catch(() => {});
    };
    window.addEventListener("m2:presentations", refresh);
    return () => window.removeEventListener("m2:presentations", refresh);
  }, [selected]);

  const handleOpenUpload = (categoryKey?: string) => {
    setUploadCategory(categoryKey);
    setUploadOpen(true);
  };

  const handleSelect = (p: Presentation) => {
    if (p.openMode === "new_tab") {
      const { url } = buildViewerUrl(p);
      window.open(url, "_blank", "noreferrer");
      return;
    }
    setSelected(p);
    setSidebarOpen(false);
  };

  // 스와이프 핸들러
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;

    // 수평 스와이프만 처리 (수직 스크롤 제외)
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (Math.abs(dx) < 50) return;

    if (dx > 0 && touchStartX.current < 30 && !sidebarOpen) {
      // 왼쪽 가장자리(30px)에서 오른쪽 스와이프 → 사이드바 열기
      setSidebarOpen(true);
    } else if (dx < 0 && sidebarOpen) {
      // 왼쪽 스와이프 → 사이드바 닫기
      setSidebarOpen(false);
    }

    touchStartX.current = null;
    touchStartY.current = null;
  }, [sidebarOpen]);

  const btnCls = [
    "hidden lg:flex fixed left-0 top-6 z-50",
    "h-9 w-6 items-center justify-center",
    "bg-sidebar border border-border border-l-0",
    "rounded-r-lg hover:bg-sidebar-hover transition shadow-md",
  ].join(" ");

  return (
    <div
      className="h-screen w-full bg-background overflow-hidden relative flex"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 데스크탑: 사이드바를 flex 레이아웃에 포함 / 모바일: fixed overlay */}
      <div className="hidden lg:flex lg:shrink-0" style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}>
        <Sidebar
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          onOpenUpload={handleOpenUpload}
          onOpenPassword={() => setPwdOpen(true)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSelectBoard={(board) => { setSelectedBoard(board); setSelected(null); setSidebarOpen(false); }}
          selectedBoardId={selectedBoard?.id ?? null}
          secretUnlocked={secretUnlocked}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onResizeStart={() => setSidebarResizing(true)}
          onResizeEnd={() => setSidebarResizing(false)}
        />
      </div>

      {/* 모바일 전용 사이드바 (overlay) */}
      <div className="lg:hidden">
        <Sidebar
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          onOpenUpload={handleOpenUpload}
          onOpenPassword={() => setPwdOpen(true)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSelectBoard={(board) => { setSelectedBoard(board); setSelected(null); setSidebarOpen(false); }}
          selectedBoardId={selectedBoard?.id ?? null}
          secretUnlocked={secretUnlocked}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onResizeStart={() => setSidebarResizing(true)}
          onResizeEnd={() => setSidebarResizing(false)}
        />
      </div>

      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className={btnCls}
          aria-label="사이드바 열기"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
      )}

      <main className="flex-1 min-w-0 bg-content flex flex-col">
        <div className="lg:hidden flex items-center gap-2 px-3 h-12 border-b border-border bg-sidebar">
          <button
            onClick={() => setSidebarOpen(true)}
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-sidebar-hover transition"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img
            src="/logo_white.png"
            alt="M2SOFT"
            className="h-7 w-auto object-contain cursor-pointer"
          />
        </div>

        <div className="flex-1 min-h-0 relative">
          {sidebarResizing && (
            <div className="absolute inset-0 z-50" />
          )}
          {selectedBoard ? (
            selectedBoard.type === "card"
              ? <BoardCard board={selectedBoard} />
              : <BoardList board={selectedBoard} />
          ) : (
            <Viewer presentation={selected} />
          )}
        </div>
      </main>

      {uploadOpen && (
        <UploadModal
          onClose={() => {
            setUploadOpen(false);
            setUploadCategory(undefined);
          }}
          defaultCategory={uploadCategory}
        />
      )}
      {pwdOpen && <PasswordModal onClose={() => setPwdOpen(false)} />}
    </div>
  );
}
