export type SourceType = "file" | "url";
export type Team = "sales" | "eng";
export type Role = "admin" | "viewer";

export const TEAM_LABELS: Record<Team, string> = {
  sales: "영업팀",
  eng: "엔지니어팀",
};

export type OpenMode = "inline" | "new_tab";

export type Presentation = {
  id: string;
  name: string;
  category: string;
  sourceType: SourceType;
  src: string;
  mime?: string;
  fileName?: string;
  createdAt: number;
  team?: Team;
  openMode?: OpenMode;
};

export type Category = { key: string; label: string };

const PWD_KEY = "m2_pwd";
const AUTH_KEY = "m2_auth";
const TEAM_KEY = "m2_team";
const ROLE_KEY = "m2_role";

const isBrowser = () => typeof window !== "undefined";

export const API_BASE: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:4000";

export function getPassword(): string {
  if (!isBrowser()) return "";
  return sessionStorage.getItem(PWD_KEY) ?? "";
}

function setStoredPassword(pwd: string) {
  if (!isBrowser()) return;
  if (pwd) sessionStorage.setItem(PWD_KEY, pwd);
  else sessionStorage.removeItem(PWD_KEY);
}

export function isAuthed(): boolean {
  if (!isBrowser()) return false;
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

export function setAuthed(v: boolean) {
  if (!isBrowser()) return;
  if (v) sessionStorage.setItem(AUTH_KEY, "1");
  else {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(TEAM_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    setStoredPassword("");
  }
}

export function getTeam(): Team | null {
  if (!isBrowser()) return null;
  const t = sessionStorage.getItem(TEAM_KEY);
  return t === "sales" || t === "eng" ? t : null;
}

function setTeam(t: Team | null) {
  if (!isBrowser()) return;
  if (t) sessionStorage.setItem(TEAM_KEY, t);
  else sessionStorage.removeItem(TEAM_KEY);
}

export function getRole(): Role | null {
  if (!isBrowser()) return null;
  const r = sessionStorage.getItem(ROLE_KEY);
  return r === "admin" || r === "viewer" ? r : null;
}

function setRole(r: Role | null) {
  if (!isBrowser()) return;
  if (r) sessionStorage.setItem(ROLE_KEY, r);
  else sessionStorage.removeItem(ROLE_KEY);
}

export function isAdmin(): boolean {
  return getRole() === "admin";
}

function notifyCategories() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event("m2:categories"));
}

function notify() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event("m2:presentations"));
}

export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { team?: Team; role?: Role };
    if (data.team !== "sales" && data.team !== "eng") return false;
    if (data.role !== "admin" && data.role !== "viewer") return false;
    setStoredPassword(password);
    setTeam(data.team);
    setRole(data.role);
    setAuthed(true);
    return true;
  } catch {
    return false;
  }
}

// --- Categories API ---
export async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/categories`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error(`카테고리 조회 실패 (${res.status})`);
  return (await res.json()) as Category[];
}

export async function addCategory(label: string): Promise<Category> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("메뉴 이름을 입력하세요.");
  const res = await fetch(`${API_BASE}/api/categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ label: trimmed }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `메뉴 추가 실패 (${res.status})`);
  }
  const cat = (await res.json()) as Category;
  notifyCategories();
  return cat;
}

export async function renameCategory(key: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("메뉴 이름을 입력하세요.");
  const res = await fetch(`${API_BASE}/api/categories/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ label: trimmed }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `이름 변경 실패 (${res.status})`);
  }
  notifyCategories();
}

export async function removeCategory(key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/categories/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error(`메뉴 삭제 실패 (${res.status})`);
  notifyCategories();
}

// --- Presentations API ---
export async function getPresentations(): Promise<Presentation[]> {
  const res = await fetch(`${API_BASE}/api/presentations`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error(`목록 조회 실패 (${res.status})`);
  return (await res.json()) as Presentation[];
}

export async function addPresentationFile(input: {
  name: string;
  category: string;
  file: File;
  openMode?: OpenMode;
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "file");
  fd.append("file", input.file);
  fd.append("openMode", input.openMode ?? "inline");
  return submit(fd);
}

export async function addPresentationUrl(input: {
  name: string;
  category: string;
  url: string;
  openMode?: OpenMode;
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "url");
  fd.append("url", input.url);
  fd.append("openMode", input.openMode ?? "inline");
  return submit(fd);
}

async function submit(fd: FormData): Promise<Presentation> {
  const res = await fetch(`${API_BASE}/api/presentations`, {
    method: "POST",
    headers: { "x-app-password": getPassword() },
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`등록 실패 (${res.status}) ${text}`);
  }
  const created = (await res.json()) as Presentation;
  notify();
  return created;
}

export async function removePresentation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/presentations/${id}`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
  notify();
}

export async function renamePresentation(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력하세요.");
  const res = await fetch(`${API_BASE}/api/presentations/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ name: trimmed }),
  });
  if (!res.ok) throw new Error(`이름 변경 실패 (${res.status})`);
  notify();
}



export async function reorderCategories(keys: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/categories/reorder`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error(`순서 변경 실패 (${res.status})`);
  notifyCategories();
}

export async function reorderPresentations(ids: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/presentations/reorder`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`순서 변경 실패 (${res.status})`);
  notify();
}



export async function changeOpenMode(id: string, openMode: OpenMode): Promise<void> {
  const res = await fetch(`${API_BASE}/api/presentations/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ openMode }),
  });
  if (!res.ok) throw new Error(`열기 방식 변경 실패 (${res.status})`);
  notify();
}

