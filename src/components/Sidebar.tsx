import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  addCategory,
  getCategories,
  getPresentations,
  getTeam,
  removePresentation,
  removeCategory,
  renameCategory,
  renamePresentation,
  setAuthed,
  TEAM_LABELS,
  type Category,
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
  Pencil,
  FolderPlus,
  PanelLeftClose,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type Props = {
  selectedId: string | null;
  onSelect: (p: Presentation) => void;
  onOpenUpload: () => void;
  onOpenPassword: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="bg-transparent text-[rgba(57,255,20,0.7)] font-semibold">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function Sidebar({
  selectedId,
  onSelect,
  onOpenUpload,
  onOpenPassword,
  open,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: Props) {
  const navigate = useNavigate();
  const [list, setList] = useState<Presentation[]>([]);
  const [cats, setCats] = useState<Category[]>(() => getCategories());
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(getCategories().map((c) => [c.key, true])),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameItemValue, setRenameItemValue] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getPresentations()
        .then((items) => {
          if (!cancelled) setList(items);
        })
        .catch((e) => console.error(e));
    };
    refresh();
    window.addEventListener("m2:presentations", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("m2:presentations", refresh);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = getCategories();
      setCats(next);
      setOpenCats((prev) => {
        const merged = { ...prev };
        for (const c of next) if (!(c.key in merged)) merged[c.key] = true;
        return merged;
      });
    };
    window.addEventListener("m2:categories", refresh);
    return () => window.removeEventListener("m2:categories", refresh);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        cats.find((c) => c.key === p.category)?.label.toLowerCase().includes(q),
    );
  }, [list, query, cats]);

  const grouped = useMemo(() => {
    const m: Record<string, Presentation[]> = {};
    for (const c of cats) m[c.key] = [];
    for (const p of filtered) (m[p.category] ??= []).push(p);
    return m;
  }, [filtered, cats]);

  const beginRename = (c: Category) => {
    setRenamingKey(c.key);
    setRenameValue(c.label);
  };

  const commitRename = () => {
    if (!renamingKey) return;
    try {
      renameCategory(renamingKey, renameValue);
    } catch (e) {
      alert(e instanceof Error ? e.message : "이름 변경 실패");
    }
    setRenamingKey(null);
  };

  const handleRemoveCategory = (c: Category) => {
    const count = (grouped[c.key] ?? []).length;
    const msg =
      count > 0
        ? `"${c.label}" 메뉴에 ${count}개의 자료가 있습니다. 메뉴를 삭제해도 자료는 남지만 보이지 않게 됩니다. 계속할까요?`
        : `"${c.label}" 메뉴를 삭제할까요?`;
    if (confirm(msg)) removeCategory(c.key);
  };

  const handleAddCategory = () => {
    const label = prompt("추가할 메뉴 이름을 입력하세요");
    if (!label) return;
    try {
      const created = addCategory(label);
      setOpenCats((s) => ({ ...s, [created.key]: true }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "메뉴 추가 실패");
    }
  };

  const beginRenameItem = (p: Presentation) => {
    setRenamingItemId(p.id);
    setRenameItemValue(p.name);
  };

  const commitRenameItem = () => {
    if (!renamingItemId) return;
    const id = renamingItemId;
    const value = renameItemValue;
    setRenamingItemId(null);
    renamePresentation(id, value).catch((err) =>
      alert(err instanceof Error ? err.message : "이름 변경 실패"),
    );
  };

  const handleRemoveItem = (p: Presentation) => {
    if (confirm(`"${p.name}"을(를) 삭제할까요?`)) {
      removePresentation(p.id).catch((err) =>
        alert(err instanceof Error ? err.message : "삭제 실패"),
      );
    }
  };

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
        transition-all duration-300 ease-out
        ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
        ${collapsed ? "lg:w-0 lg:overflow-hidden lg:border-r-0" : ""}`}
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
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <span>more than the most</span>
                {getTeam() && (
                  <span className="px-1.5 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
                    {TEAM_LABELS[getTeam()!]}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden h-8 w-8 grid place-items-center rounded-lg hover:bg-sidebar-hover transition">
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="hidden lg:grid h-8 w-8 place-items-center rounded-lg hover:bg-sidebar-hover transition"
            aria-label="사이드바 접기"
          >
            <PanelLeftClose className="h-4 w-4" />
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
        <nav className="mt-3 px-2 flex-1 overflow-y-auto pb-4 flex flex-col">
          <div className="space-y-0.5">
            {cats.map((c) => {
            const items = grouped[c.key] ?? [];
            const isOpen = openCats[c.key];
            return (
              <div key={c.key}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => setOpenCats((s) => ({ ...s, [c.key]: !s[c.key] }))}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-sidebar-hover transition group"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-brand transition" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-brand transition" />
                      )}
                      {renamingKey === c.key ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingKey(null);
                            }
                          }}
                          className="flex-1 h-6 px-1.5 rounded bg-input border border-brand text-sm outline-none"
                        />
                      ) : (
                        <span className="font-medium text-sm flex-1 text-left">{c.label}</span>
                      )}
                      {items.length > 0 && renamingKey !== c.key && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/20 text-brand font-semibold">
                          {items.length}
                        </span>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    <ContextMenuItem onClick={() => beginRename(c)}>
                      <Pencil className="h-4 w-4 mr-2 text-brand" /> 이름변경
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleRemoveCategory(c)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> 삭제
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {isOpen && items.length > 0 && (
                  <ul className="ml-3 pl-3 border-l border-border/60 space-y-0.5 mt-0.5 mb-1">
                    {items.map((p) => {
                      const active = selectedId === p.id;
                      return (
                        <li key={p.id}>
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <div
                                className={`group flex items-center gap-2 rounded-lg pr-1 transition ${
                                  active
                                    ? "bg-brand/15 text-brand"
                                    : "hover:bg-sidebar-hover text-sidebar-foreground"
                                }`}
                              >
                                {renamingItemId === p.id ? (
                                  <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2">
                                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    <input
                                      autoFocus
                                      value={renameItemValue}
                                      onChange={(e) => setRenameItemValue(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onBlur={commitRenameItem}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          commitRenameItem();
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          setRenamingItemId(null);
                                        }
                                      }}
                                      className="flex-1 h-6 px-1.5 rounded bg-input border border-brand text-sm outline-none"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => onSelect(p)}
                                    className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-sm"
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    <span className="truncate">{highlight(p.name, query)}</span>
                                  </button>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-40">
                              <ContextMenuItem onClick={() => beginRenameItem(p)}>
                                <Pencil className="h-4 w-4 mr-2 text-brand" /> 이름변경
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => handleRemoveItem(p)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> 삭제
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
            })}
          </div>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex-1 min-h-[80px]" />
            </ContextMenuTrigger>
            <ContextMenuContent className="w-40">
              <ContextMenuItem onClick={handleAddCategory}>
                <FolderPlus className="h-4 w-4 mr-2 text-brand" /> 메뉴추가
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
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