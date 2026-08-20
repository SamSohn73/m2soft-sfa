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
  allowDownload?: boolean;
};

export type Category = { key: string; label: string };

const PWD_KEY = "m2_pwd";
const AUTH_KEY = "m2_auth";
const TEAM_KEY = "m2_team";
const ROLE_KEY = "m2_role";

const isBrowser = () => typeof window !== "undefined";

export const API_BASE: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE?.replace(/\/$/, "") || "";

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
  allowDownload?: boolean;
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "file");
  fd.append("file", input.file);
  fd.append("openMode", input.openMode ?? "inline");
  fd.append("allowDownload", input.allowDownload === false ? "false" : "true");
  return submit(fd);
}

export async function addPresentationUrl(input: {
  name: string;
  category: string;
  url: string;
  openMode?: OpenMode;
  allowDownload?: boolean;
}): Promise<Presentation> {
  const fd = new FormData();
  fd.append("name", input.name);
  fd.append("category", input.category);
  fd.append("sourceType", "url");
  fd.append("url", input.url);
  fd.append("openMode", input.openMode ?? "inline");
  fd.append("allowDownload", input.allowDownload === false ? "false" : "true");
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


export async function changeAllowDownload(id: string, allowDownload: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/api/presentations/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-app-password": getPassword(),
    },
    body: JSON.stringify({ allowDownload }),
  });
  if (!res.ok) throw new Error(`다운로드 설정 변경 실패 (${res.status})`);
  notify();
}

// ══════════════════════════════════════════════════════════════
// 게시판 타입 및 API
// ══════════════════════════════════════════════════════════════

export type BoardType = "list" | "card";
export type BoardAllowWrite = "admin" | "all";

export type Board = {
  id: string;
  name: string;
  type: BoardType;
  allowWrite: BoardAllowWrite;
  team: string;
  secret: boolean;
  createdAt: string;
  order: number;
};

export type Attachment = {
  name: string;      // 원본 파일명
  stored: string;     // 서버 저장 파일명
  size: number;        // bytes
};

export type Post = {
  id: string;
  boardId: string;
  title: string;
  content: string;
  author: string;
  team: string;
  createdAt: string;
  updatedAt: string;
  views: number;
  thumbnail: string;
  url: string;
  sourceName: string;
  attachments: string; // "name|stored|size;name2|stored2|size2" 형식 원본 문자열
  isAutoCollected?: string; // "true"면 자동수집된 게시글
  matchedKeyword?: string;   // 자동수집 시 매칭된 키워드
};

// ── 첨부파일 문자열 파싱 유틸 ──────────────────────────────────
export function parseAttachments(raw: string): Attachment[] {
  if (!raw) return [];
  return raw.split(";").filter(Boolean).map(entry => {
    const [nameEnc, stored, size] = entry.split("|");
    return {
      name: nameEnc ? decodeURIComponent(nameEnc) : "파일",
      stored: stored || "",
      size: parseInt(size) || 0,
    };
  });
}

export function attachmentDownloadUrl(boardId: string, att: Attachment): string {
  return `${API_BASE}/api/boards/${boardId}/attachments/${att.stored}?name=${encodeURIComponent(att.name)}`;
}

// ── 첨부파일 다운로드 (인증 헤더 포함, Blob 방식) ──────────────
export async function downloadAttachment(boardId: string, att: Attachment): Promise<void> {
  const url = attachmentDownloadUrl(boardId, att);
  const res = await fetch(url, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("다운로드 실패");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = att.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── 게시판 CRUD ────────────────────────────────────────────────
export async function getBoards(): Promise<Board[]> {
  const res = await fetch(`${API_BASE}/api/boards`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("게시판 목록 조회 실패");
  return res.json();
}

export async function createBoard(input: {
  name: string; type: BoardType; allowWrite: BoardAllowWrite; team: string; secret?: boolean;
}): Promise<Board> {
  const res = await fetch(`${API_BASE}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-password": getPassword() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("게시판 생성 실패");
  return res.json();
}

export async function updateBoard(boardId: string, input: { name?: string; allowWrite?: BoardAllowWrite }): Promise<Board> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-app-password": getPassword() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("게시판 수정 실패");
  return res.json();
}

export async function deleteBoard(boardId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("게시판 삭제 실패");
}

export async function reorderBoards(ids: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/reorder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-app-password": getPassword() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("게시판 순서 변경 실패");
}

// ── 게시글 조회 ──────────────────────────────────────────────
export async function getPosts(boardId: string): Promise<Post[]> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("게시글 목록 조회 실패");
  return res.json();
}

export async function getPost(boardId: string, postId: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts/${postId}`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("게시글 조회 실패");
  return res.json();
}

// ── 게시글 작성 (첨부파일 최대 3개, multipart/form-data) ───────
export async function createPost(boardId: string, input: {
  title: string;
  content: string;
  thumbnail?: string;
  url?: string;
  sourceName?: string;
  files?: File[];
}): Promise<Post> {
  const fd = new FormData();
  fd.append("title", input.title);
  fd.append("content", input.content || "");
  if (input.thumbnail) fd.append("thumbnail", input.thumbnail);
  if (input.url) fd.append("url", input.url);
  if (input.sourceName) fd.append("sourceName", input.sourceName);
  (input.files || []).slice(0, 3).forEach(f => fd.append("files", f));

  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts`, {
    method: "POST",
    headers: { "x-app-password": getPassword() },
    body: fd,
  });
  if (!res.ok) throw new Error("게시글 작성 실패");
  return res.json();
}

// ── 게시글 수정 (기존 첨부파일 유지 + 신규 추가) ────────────────
export async function updatePost(boardId: string, postId: string, input: {
  title?: string;
  content?: string;
  thumbnail?: string;
  url?: string;
  sourceName?: string;
  keepAttachmentsRaw?: string; // 유지할 기존 첨부파일 원본 문자열
  newFiles?: File[];
}): Promise<Post> {
  const fd = new FormData();
  if (input.title !== undefined) fd.append("title", input.title);
  if (input.content !== undefined) fd.append("content", input.content);
  if (input.thumbnail !== undefined) fd.append("thumbnail", input.thumbnail);
  if (input.url !== undefined) fd.append("url", input.url);
  if (input.sourceName !== undefined) fd.append("sourceName", input.sourceName);
  if (input.keepAttachmentsRaw !== undefined) fd.append("keepAttachments", input.keepAttachmentsRaw);
  (input.newFiles || []).slice(0, 3).forEach(f => fd.append("files", f));

  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts/${postId}`, {
    method: "PATCH",
    headers: { "x-app-password": getPassword() },
    body: fd,
  });
  if (!res.ok) throw new Error("게시글 수정 실패");
  return res.json();
}

export async function deletePost(boardId: string, postId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts/${postId}`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("게시글 삭제 실패");
}

export async function deleteAttachment(boardId: string, postId: string, storedName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/posts/${postId}/attachments/${storedName}`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("첨부파일 삭제 실패");
}

// ══════════════════════════════════════════════════════════════
// 뉴스 자동 수집(크롤링) 규칙 API
// ══════════════════════════════════════════════════════════════

export type ScheduleType = "daily" | "weekly" | "monthly";

export type SearchScope = "title" | "title_content";

export type CrawlRule = {
  id: string;
  boardId: string;
  enabled: boolean;
  keywords: string[];
  scheduleType: ScheduleType;
  dayOfWeek: number;   // 0(일)~6(토), weekly일 때만 의미
  dayOfMonth: number;  // 1~28, monthly일 때만 의미
  hour: number;
  minute: number;
  maxPerRun: number;
  maxInitialBackfill: number;
  searchScope: SearchScope;
  lastRunAt: string | null;
  createdAt: string;
};

export type CrawlLog = {
  id: string;
  ruleId: string;
  ranAt: string;
  status: "success" | "failed";
  collected: number;
  duplicates: number;
  errorMsg: string | null;
};

export async function getCrawlRule(boardId: string): Promise<CrawlRule | null> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/crawl-rule`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("크롤링 규칙 조회 실패");
  return res.json();
}

export async function saveCrawlRule(boardId: string, input: {
  enabled: boolean;
  keywords: string[];
  scheduleType: ScheduleType;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour: number;
  minute: number;
  maxPerRun: number;
  maxInitialBackfill: number;
  searchScope: SearchScope;
}): Promise<CrawlRule> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/crawl-rule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-password": getPassword() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("크롤링 규칙 저장 실패");
  return res.json();
}

export async function deleteCrawlRule(boardId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/crawl-rule`, {
    method: "DELETE",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("크롤링 규칙 삭제 실패");
}

export async function runCrawlNow(boardId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/crawl-rule/run-now`, {
    method: "POST",
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("즉시 실행 실패");
}

export async function getCrawlLogs(boardId: string): Promise<CrawlLog[]> {
  const res = await fetch(`${API_BASE}/api/boards/${boardId}/crawl-logs`, {
    headers: { "x-app-password": getPassword() },
  });
  if (!res.ok) throw new Error("실행 이력 조회 실패");
  return res.json();
}
