// Backend-backed store. CSV + 파일은 사내 백엔드(backend/) 가 관리합니다.
export type SourceType = "file" | "url";
export type Team = "sales" | "eng";

export const TEAM_LABELS: Record<Team, string> = {
  sales: "영업팀",
  eng: "엔지니어팀",
};

export type Presentation = {
  id: string;
  name: string;
  category: string;
  sourceType: SourceType;
  src: string; // file: 백엔드 HTTP URL, url: 원본 URL
  mime?: string;
  fileName?: string;
  createdAt: number;
  team?: Team;
};

export const CATEGORIES = [
  { key: "company", label: "회사소개" },
  { key: "strategy", label: "전략기획" },
  { key: "product", label: "제품기획" },
  { key: "sales", label: "영업자료" },
  { key: "reference", label: "참고자료" },
  { key: "education", label: "교육자료" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export type Category = { key: string; label: string };

const CATS_KEY_BASE = "m2_categories";
const LEGACY_CATS_KEY = "m2_categories";

function catsKey(): string {
  const t = getTeam();
  return t ? `${CATS_KEY_BASE}_${t}` : CATS_KEY_BASE;
}

function readCats(): Category[] {
  if (!isBrowser()) return CATEGORIES.map((c) => ({ ...c }));
  try {
    const key = catsKey();
    let raw = localStorage.getItem(key);
    // One-time migration from the pre-team key to the per-team key.
    if (!raw && key !== LEGACY_CATS_KEY) {
      const legacy = localStorage.getItem(LEGACY_CATS_KEY);
      if (legacy) {
        localStorage.setItem(key, legacy);
        raw = legacy;
      }
    }
    if (raw) {
      const parsed = JSON.parse(raw) as Category[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return CATEGORIES.map((c) => ({ ...c }));
}

function writeCats(cats: Category[]) {
  if (!isBrowser()) return;
  localStorage.setItem(catsKey(), JSON.stringify(cats));
  window.dispatchEvent(new Event("m2:categories"));
}

export function getCategories(): Category[] {
  return readCats();
}

export function addCategory(label: string): Category {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("메뉴 이름을 입력하세요.");
  const cats = readCats();
  if (cats.some((c) => c.label === trimmed)) throw new Error("같은 이름의 메뉴가 이미 있습니다.");
  const key = `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next: Category = { key, label: trimmed };
  writeCats([...cats, next]);
  return next;
}

export function renameCategory(key: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("메뉴 이름을 입력하세요.");
  const cats = readCats();
  if (cats.some((c) => c.key !== key && c.label === trimmed))
    throw new Error("같은 이름의 메뉴가 이미 있습니다.");
  writeCats(cats.map((c) => (c.key === key ? { ...c, label: trimmed } : c)));
}

export function removeCategory(key: string): void {
  const cats = readCats().filter((c) => c.key !== key);
  writeCats(cats);
}

const PWD_KEY = "m2_pwd";
const AUTH_KEY = "m2_auth";
const TEAM_KEY = "m2_team";

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

function notify() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event("m2:presentations"));
}

/** 서버에 비밀번호 검증. 성공 시 sessionStorage 에 저장. */
export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { team?: Team };
    if (data.team !== "sales" && data.team !== "eng") return false;
    setStoredPassword(password);
    setTeam(data.team);
    setAuthed(true);
    return true;
  } catch {
    return false;
  }
}

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
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "file");
  fd.append("file", input.file);
  return submit(fd);
}

export async function addPresentationUrl(input: {
  name: string;
  category: string;
  url: string;
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "url");
  fd.append("url", input.url);
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
