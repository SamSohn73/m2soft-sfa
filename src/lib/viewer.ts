import type { Presentation } from "./store";

export type ViewerKind =
  | "pdf"
  | "image"
  | "youtube"
  | "gdrive"
  | "office"
  | "webpage"
  | "video"
  | "audio"
  | "unknown";

const officeExt = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
const imageExt = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

function getExt(s: string): string {
  const m = s.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m?.[1] ?? "";
}

export function youtubeId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([\w-]+)/,
    /youtu\.be\/([\w-]+)/,
    /youtube\.com\/embed\/([\w-]+)/,
    /youtube\.com\/shorts\/([\w-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function gdriveFileId(url: string): string | null {
  let m = url.match(/\/file\/d\/([\w-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([\w-]+)/);
  if (m) return m[1];
  m = url.match(/\/document\/d\/([\w-]+)/);
  if (m) return m[1];
  m = url.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (m) return m[1];
  m = url.match(/\/presentation\/d\/([\w-]+)/);
  if (m) return m[1];
  return null;
}

export function detectKind(p: Presentation): ViewerKind {
  if (p.sourceType === "url") {
    if (youtubeId(p.src)) return "youtube";
    if (/drive\.google\.com|docs\.google\.com/.test(p.src)) return "gdrive";
    const ext = getExt(p.src);
    if (ext === "pdf") return "pdf";
    if (imageExt.includes(ext)) return "image";
    if (officeExt.includes(ext)) return "office";
    return "webpage";
  }
  // file
  const mime = p.mime ?? "";
  const ext = getExt(p.fileName ?? "");
  if (mime.startsWith("image/") || imageExt.includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (officeExt.includes(ext)) return "office";
  return "unknown";
}

export function buildViewerUrl(p: Presentation): { kind: ViewerKind; url: string } {
  const kind = detectKind(p);
  switch (kind) {
    case "youtube": {
      const id = youtubeId(p.src)!;
      return { kind, url: `https://www.youtube.com/embed/${id}` };
    }
    case "gdrive": {
      const id = gdriveFileId(p.src);
      if (id) return { kind, url: `https://drive.google.com/file/d/${id}/preview` };
      return { kind, url: p.src };
    }
    case "office": {
      // Only works for publicly accessible URLs (not data URLs)
      if (p.sourceType === "url") {
        return {
          kind,
          url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(p.src)}`,
        };
      }
      return { kind, url: p.src };
    }
    default:
      return { kind, url: p.src };
  }
}
