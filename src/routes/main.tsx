import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Viewer } from "@/components/Viewer";
import { UploadModal } from "@/components/UploadModal";
import { PasswordModal } from "@/components/PasswordModal";
import { getPresentations, isAuthed, type Presentation } from "@/lib/store";
import { Menu } from "lucide-react";

export const Route = createFileRoute("/main")({
  head: () => ({
    meta: [
      { title: "M2SOFT Document Viewer" },
      { name: "description", content: "다양한 문서를 한 곳에서 미리보세요." },
    ],
  }),
  component: MainPage,
});

function MainPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Presentation | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthed()) navigate({ to: "/" });
  }, [navigate]);

  // Keep selected fresh / clear if deleted
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

  return (
    <div className="h-screen w-full flex bg-background overflow-hidden">
      <Sidebar
        selectedId={selected?.id ?? null}
        onSelect={(p) => {
          setSelected(p);
          setSidebarOpen(false);
        }}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenPassword={() => setPwdOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 min-w-0 bg-content flex flex-col">
        {/* Mobile top bar */}
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

        <div className="flex-1 min-h-0">
          <Viewer presentation={selected} />
        </div>
      </main>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
      {pwdOpen && <PasswordModal onClose={() => setPwdOpen(false)} />}
    </div>
  );
}
