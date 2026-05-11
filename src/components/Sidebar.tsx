import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CATEGORIES,
  getPresentations,
  removePresentation,
  setAuthed,
  type Presentation,
} from "@/lib/store";
import {
  Plus,
  Search,
  Menu,
  ChevronDown,
  ChevronRight,
  KeyRound,
  LogOut,
  X,
  FileText,
  Trash2,
} from "lucide-react";

type Props = {
  selectedId: string | null;
  onSelect: (p: Presentation) => void;
  onOpenUpload: () => void;
  onOpenPassword: () => void;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({
  selectedId,
  onSelect,
  onOpenUpload,
  onOpenPassword,
  open,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const [list, setList] = useState<Presentation[]>([]);
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.key, true])),
  );
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setList(getPresentations());
    refresh();
    window.addEventListener("m2:presentations", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("m2:presentations", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        CATEGORIES.find((c) => c.key === p.category)?.label.toLowerCase().includes(q),
    );
  }, [list, query]);

  const grouped = useMemo(() => {
    const m: Record<string, Presentation[]> = {};
    for (const c of CATEGORIES) m[c.key] = [];
    for (const p of filtered) (m[p.category] ??= []).push(p);
    return m;
  }, [filtered]);

  const logout = () => {
    setAuthed(false);
    navigate({ to: "/" });
  };

  return (
    <>
      {/* Overlay (mobile) */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden animate-in fade-in"
        />
      )}

      <aside
        className={`fixed lg:static z-40 inset-y-0 left-0 w-[280px] bg-sidebar text-sidebar-foreground border-r border-border flex flex-col
        transition-transform duration-300 ease-out
        ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl gradient-brand grid place-items-center font-extrabold text-primary-foreground glow-brand">
              M²
            </div>
            <div className="leading-tight">
              <div className="font-extrabold tracking-tight text-lg">
                <span>M2</span>
                <span className="text-brand">SOFT</span>
              </div>
              <div className="text-[10px] text-muted-foreground">more than the most</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden h-8 w-8 grid place-items-center rounded-lg hover:bg-sidebar-hover transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Upload button */}
        <div className="px-4">
          <button
            onClick={onOpenUpload}
            className="w-full h-11 rounded-xl gradient-brand text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[.98] transition glow-brand"
          >
            <Plus className="h-4 w-4" /> 프리젠테이션 등록
          </button>
        </div>

        {/* Search */}
        <div className="px-4 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="메뉴 검색..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-sidebar-hover/60 border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 text-sm transition"
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="mt-3 px-2 flex-1 overflow-y-auto pb-4 space-y-0.5">
          {CATEGORIES.map((c) => {
            const items = grouped[c.key] ?? [];
            const isOpen = openCats[c.key];
            return (
              <div key={c.key}>
                <button
                  onClick={() => setOpenCats((s) => ({ ...s, [c.key]: !s[c.key] }))}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-sidebar-hover transition group"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-brand transition" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-brand transition" />
                  )}
                  <span className="font-medium text-sm flex-1 text-left">{c.label}</span>
                  {items.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
                      {items.length}
                    </span>
                  )}
                </button>
                {isOpen && items.length > 0 && (
                  <ul className="ml-3 pl-3 border-l border-border/60 space-y-0.5 mt-0.5 mb-1">
                    {items.map((p) => {
                      const active = selectedId === p.id;
                      return (
                        <li key={p.id}>
                          <div
                            className={`group flex items-center gap-2 rounded-lg pr-1 transition ${
                              active
                                ? "bg-brand/15 text-brand"
                                : "hover:bg-sidebar-hover text-sidebar-foreground"
                            }`}
                          >
                            <button
                              onClick={() => onSelect(p)}
                              className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-sm"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              <span className="truncate">{highlight(p.name, query)}</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`"${p.name}"을(를) 삭제할까요?`)) removePresentation(p.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 h-7 w-7 grid place-items-center rounded hover:bg-destructive/20 hover:text-destructive transition"
                              aria-label="삭제"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer hamburger */}
        <div className="relative border-t border-border p-3">
          {menuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl bg-popover border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenPassword();
                }}
                className="w-full px-4 py-3 flex items-center gap-2.5 hover:bg-accent transition text-sm"
              >
                <KeyRound className="h-4 w-4 text-brand" /> 비밀번호 변경
              </button>
              <button
                onClick={logout}
                className="w-full px-4 py-3 flex items-center gap-2.5 hover:bg-accent transition text-sm border-t border-border"
              >
                <LogOut className="h-4 w-4 text-destructive" /> 로그아웃
              </button>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="h-10 w-10 rounded-lg flex items-center justify-center hover:bg-sidebar-hover transition"
            aria-label="메뉴"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
