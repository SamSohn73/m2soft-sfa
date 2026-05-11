// Local storage backed store for password & presentations
export type SourceType = "file" | "url";

export type Presentation = {
  id: string;
  name: string;
  category: string; // category key
  sourceType: SourceType;
  // For file: data URL; For url: original URL
  src: string;
  mime?: string;
  fileName?: string;
  createdAt: number;
};

const PWD_KEY = "m2_pwd";
const AUTH_KEY = "m2_auth";
const PRES_KEY = "m2_presentations";

export const DEFAULT_PASSWORD = "2188";

export const CATEGORIES = [
  { key: "company", label: "회사소개" },
  { key: "strategy", label: "전략기획" },
  { key: "product", label: "제품기획" },
  { key: "sales", label: "영업자료" },
  { key: "reference", label: "참고자료" },
  { key: "education", label: "교육자료" },
] as const;

export type CategoryKey = typeof CATEGORIES[number]["key"];

const isBrowser = () => typeof window !== "undefined";

export function getPassword(): string {
  if (!isBrowser()) return DEFAULT_PASSWORD;
  return localStorage.getItem(PWD_KEY) ?? DEFAULT_PASSWORD;
}

export function setPassword(pwd: string) {
  if (!isBrowser()) return;
  localStorage.setItem(PWD_KEY, pwd);
}

export function isAuthed(): boolean {
  if (!isBrowser()) return false;
  return localStorage.getItem(AUTH_KEY) === "1";
}

export function setAuthed(v: boolean) {
  if (!isBrowser()) return;
  if (v) localStorage.setItem(AUTH_KEY, "1");
  else localStorage.removeItem(AUTH_KEY);
}

export function getPresentations(): Presentation[] {
  if (!isBrowser()) return [];
  try {
    return JSON.parse(localStorage.getItem(PRES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function savePresentations(list: Presentation[]) {
  if (!isBrowser()) return;
  localStorage.setItem(PRES_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("m2:presentations"));
}

export function addPresentation(p: Presentation) {
  const list = getPresentations();
  list.push(p);
  savePresentations(list);
}

export function removePresentation(id: string) {
  savePresentations(getPresentations().filter((p) => p.id !== id));
}
