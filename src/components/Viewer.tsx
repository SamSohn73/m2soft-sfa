import { buildViewerUrl } from "@/lib/viewer";
import type { Presentation } from "@/lib/store";
import { FileQuestion, Download, ExternalLink } from "lucide-react";

export function Viewer({ presentation }: { presentation: Presentation | null }) {
  if (!presentation) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-md">
          <div className="h-20 w-20 mx-auto rounded-2xl gradient-brand grid place-items-center mb-6 glow-brand">
            <FileQuestion className="h-9 w-9 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">문서를 선택하세요</h2>
          <p className="text-muted-foreground text-sm">
            좌측 사이드바에서 <span className="text-brand font-semibold">프리젠테이션 등록</span> 버튼을 눌러
            PDF, Word, Excel, PPT, 이미지, 유튜브, Google Drive 링크 등을 추가하세요.
          </p>
        </div>
      </div>
    );
  }

  const { kind, url } = buildViewerUrl(presentation);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card/40">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">{presentation.name}</h2>
          <p className="text-xs text-muted-foreground truncate">
            {presentation.fileName ?? presentation.src}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {presentation.sourceType === "file" && (
            <a
              href={presentation.src}
              download={presentation.fileName ?? presentation.name}
              className="h-9 px-3 rounded-lg border border-border hover:bg-accent transition flex items-center gap-1.5 text-sm"
            >
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">다운로드</span>
            </a>
          )}
          {presentation.sourceType === "url" && (
            <a
              href={presentation.src}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-3 rounded-lg border border-border hover:bg-accent transition flex items-center gap-1.5 text-sm"
            >
              <ExternalLink className="h-4 w-4" /> <span className="hidden sm:inline">새 탭</span>
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-content">
        <ViewerBody kind={kind} url={url} presentation={presentation} />
      </div>
    </div>
  );
}

function ViewerBody({
  kind,
  url,
  presentation,
}: {
  kind: ReturnType<typeof buildViewerUrl>["kind"];
  url: string;
  presentation: Presentation;
}) {
  if (kind === "image") {
    return (
      <div className="h-full w-full overflow-auto grid place-items-center p-4">
        <img src={url} alt={presentation.name} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="h-full w-full grid place-items-center p-4 bg-black">
        <video src={url} controls className="max-w-full max-h-full" />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="h-full w-full grid place-items-center p-6">
        <audio src={url} controls className="w-full max-w-xl" />
      </div>
    );
  }
  if (kind === "office" && presentation.sourceType === "file") {
    return (
      <div className="h-full w-full grid place-items-center text-center p-8">
        <div className="max-w-md">
          <FileQuestion className="h-12 w-12 mx-auto text-brand mb-4" />
          <h3 className="font-semibold mb-2">Office 파일은 다운로드 후 확인해주세요</h3>
          <p className="text-sm text-muted-foreground mb-5">
            로컬 업로드된 Word/Excel/PPT 파일은 브라우저에서 직접 미리보기가 제한됩니다.
            공개 URL을 사용하시면 미리보기가 가능합니다.
          </p>
          <a
            href={url}
            download={presentation.fileName}
            className="inline-flex h-11 px-5 rounded-lg gradient-brand text-primary-foreground font-semibold items-center gap-2"
          >
            <Download className="h-4 w-4" /> 파일 다운로드
          </a>
        </div>
      </div>
    );
  }
  // pdf, youtube, gdrive, office(url), webpage, unknown(file)
  return (
    <iframe
      src={url}
      title={presentation.name}
      className="h-full w-full border-0"
      allow="autoplay; encrypted-media; fullscreen"
      allowFullScreen
    />
  );
}
