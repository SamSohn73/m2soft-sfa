import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Viewer } from "@/components/Viewer";
import { UploadModal } from "@/components/UploadModal";
import { PasswordModal } from "@/components/PasswordModal";
import { getPresentations, isAuthed, type Presentation } from "@/lib/store";
import { Menu, PanelLeftOpen } from "lucide-react";
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

  const btnCls = [
    "hidden lg:flex fixed left-0 top-6 z-50",
    "h-9 w-6 items-center justify-center",
    "bg-sidebar border border-border border-l-0",
    "rounded-r-lg hover:bg-sidebar-hover transition shadow-md",
  ].join(" ");

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden relative">
      <Sidebar
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
        onOpenUpload={handleOpenUpload}
        onOpenPassword={() => setPwdOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        onResizeStart={() => setSidebarResizing(true)}
        onResizeEnd={() => setSidebarResizing(false)}
      />

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
          <span className="font-bold tracking-tight">
            M2<span className="text-brand">SOFT</span>
          </span>
        </div>

        <div className="flex-1 min-h-0 relative">
          {sidebarResizing && (
            <div className="absolute inset-0 z-50" />
          )}
          <Viewer presentation={selected} />
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