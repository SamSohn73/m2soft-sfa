// Backend-backed store. CSV + 파일은 사내 백엔드(backend/) 가 관리합니다.
export type SourceType = "file" | "url";

export type Presentation = {
  id: string;
  name: string;
  category: string;
  sourceType: SourceType;
  src: string; // file: 백엔드 HTTP URL, url: 원본 URL
  mime?: string;
  fileName?: string;
  createdAt: number;
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

const PWD_KEY = "m2_pwd";
const AUTH_KEY = "m2_auth";

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
    setStoredPassword("");
  }
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
    setStoredPassword(password);
    setAuthed(true);
    return true;
  } catch {
    return false;
  }
}

export async function getPresentations(): Promise<Presentation[]> {
  const res = await fetch(`${API_BASE}/api/presentations`);
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
