// hwp-worker: hwp/hwpx 파일을 받아 LibreOffice(H2Orestart)로 텍스트를 추출해 돌려주는
// 아주 얇은 HTTP 서비스. 컨테이너 하나 = 동시 1작업. 몇 개를 동시에 처리할지는
// docker-compose에서 이 서비스를 몇 개(레플리카) 띄우느냐로 조절한다.
//
// 메인 Node 서버(server.js)의 extractHwpTextViaLibreOffice가 로컬 LibreOffice를 직접
// 실행하던 것과 거의 동일한 로직이지만, 이 컨테이너는 완전히 격리된 프로필/프로세스라
// 다른 요청과 락 충돌을 걱정할 필요가 없어서 직렬화 큐가 필요 없다.
import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 4100;
const TMP_DIR = "/tmp/hwp-worker";
fs.mkdirSync(TMP_DIR, { recursive: true });

// 파일 하나를 통째로 바이너리 그대로 받는다 (메인 서버는 multipart 없이 raw body로 보냄).
app.use(express.raw({ type: "*/*", limit: "20mb" }));

// 컨테이너 하나 = 동시 1작업이 이 설계의 전제인데, Express/Node는 요청이 동시에 들어오면
// 그냥 다 받아버리므로(디스패처가 실수로 같은 워커에 두 건을 몰아보내는 경우 등), 한 프로필을
// 두 soffice 프로세스가 동시에 쓰는 예전 문제가 컨테이너 안에서 재현될 수 있다. 이를 막기
// 위해 변환 작업 자체를 컨테이너 내부에서도 명시적으로 직렬화한다.
let convertQueue = Promise.resolve();
function runSerialized(task) {
  const result = convertQueue.then(task, task);
  convertQueue = result.catch(() => {});
  return result;
}

// headless 모드라도 이전 실행이 비정상 종료되어 프로필 잠금파일이 남아있으면 숨은 복구
// 대화상자 때문에 멈춰있는 것처럼 보일 수 있다 — --nolockcheck로 그 확인 자체를 건너뛴다.
const SOFFICE_SAFE_FLAGS = ["--headless", "--invisible", "--nodefault", "--nofirststartwizard", "--nolockcheck", "--nologo", "--norestore"];

// 정상적으로 되는 hwp/hwpx는 실제로 관찰해보니 거의 다 수 초~10초 안에 끝난다(가장
// 느렸던 정상 사례도 7.5초, 8.1MB짜리 큰 파일도 1초 만에 끝남). 반면 LibreOffice
// 변환 필터에서 막히는 "말썽 파일"은 몇 분을 줘도 어차피 안 끝난다 — 그래서 예전엔
// 240초까지 기다렸지만, 실제로 그 240초를 다 채운 건 전부 결국 실패로 끝난 케이스뿐이라
// 60초로 줄여도 정상 파일엔 영향이 없고, 말썽 파일 하나가 워커 슬롯을 붙잡고 있는
// 시간만 1/4로 줄어든다 (실제로 겪은 문제 기준으로 조정한 값 — 필요시 다시 조정).
const SOFFICE_TIMEOUT_MS = 60000;

// 결과 txt 파일이 "완전히 다 쓰여졌는지"를 파일 크기 안정화로 판별한다.
// (server.js의 waitForFileStable과 동일한 이유 — soffice 변환 완료를 execFile 콜백만으로는
//  신뢰할 수 없는 경우가 있어, 크기가 여러 번 연속 동일해질 때까지 폴링한다.)
function waitForFileStable(filePath, { intervalMs = 500, maxWaitMs = SOFFICE_TIMEOUT_MS, requiredStableChecks = 3 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let lastSize = -1;
    let stableCount = 0;
    const timer = setInterval(() => {
      if (Date.now() - start > maxWaitMs) {
        clearInterval(timer);
        resolve(fs.existsSync(filePath) && lastSize > 0);
        return;
      }
      if (fs.existsSync(filePath)) {
        const size = fs.statSync(filePath).size;
        if (size > 0 && size === lastSize) {
          stableCount++;
          if (stableCount >= requiredStableChecks) {
            clearInterval(timer);
            resolve(true);
            return;
          }
        } else {
          stableCount = 0;
        }
        lastSize = size;
      }
    }, intervalMs);
  });
}

app.post("/convert", async (req, res) => {
  const ext = String(req.query.ext || "").toLowerCase();
  // format=text(기본): 검색/키워드매칭용 텍스트 추출. format=pdf: 브라우저 미리보기용
  // PDF 변환 — 같은 파일, 같은 soffice 호출 경로를 쓰되 --convert-to 대상만 다르다.
  const format = String(req.query.format || "text").toLowerCase();
  // doc/docx는 hwp/hwpx와 완전히 동일한 경로(soffice --convert-to)로 처리된다 -
  // LibreOffice가 원래 지원하는 포맷이라 별도 필터(H2Orestart) 없이도 바로 된다.
  if (!["hwp", "hwpx", "doc", "docx"].includes(ext)) {
    return res.status(400).json({ success: false, reason: "unsupported_ext" });
  }
  if (!["text", "pdf"].includes(format)) {
    return res.status(400).json({ success: false, reason: "unsupported_format" });
  }
  const buf = req.body;
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ success: false, reason: "empty_body" });
  }

  const result = await runSerialized(() => doConvert(buf, ext, format));
  res.status(result.status).json(result.body);
});

async function doConvert(buf, ext, format) {
  const id = crypto.randomUUID();
  const inPath = path.join(TMP_DIR, `${id}.${ext}`);
  const outDir = path.join(TMP_DIR, id);
  fs.mkdirSync(outDir, { recursive: true });
  const isPdf = format === "pdf";
  const outPath = path.join(outDir, `${id}.${isPdf ? "pdf" : "txt"}`);
  const convertToArg = isPdf ? "pdf" : "txt:Text (encoded):UTF8";

  const startedAt = Date.now();
  try {
    fs.writeFileSync(inPath, buf);
    console.log(`[convert:${format}] 시작: ${id}.${ext} (${buf.length} bytes)`);

    await new Promise((resolve) => {
      execFile(
        "soffice",
        [...SOFFICE_SAFE_FLAGS, "--convert-to", convertToArg, "--outdir", outDir, inPath],
        { timeout: SOFFICE_TIMEOUT_MS },
        () => resolve() // 성공/실패 여부와 무관하게, 실제 완료는 아래에서 파일로 재확인
      );
    });

    const ok = await waitForFileStable(outPath, { maxWaitMs: SOFFICE_TIMEOUT_MS });
    if (!ok) {
      console.log(`[convert:${format}] 타임아웃 (${Date.now() - startedAt}ms): ${id}.${ext}`);
      return { status: 200, body: { success: false, reason: "timeout" } };
    }

    if (isPdf) {
      const pdfBuf = fs.readFileSync(outPath);
      if (!pdfBuf || pdfBuf.length === 0) {
        console.log(`[convert:pdf] 빈 결과 (${Date.now() - startedAt}ms): ${id}.${ext}`);
        return { status: 200, body: { success: false, reason: "empty_output" } };
      }
      console.log(`[convert:pdf] 완료 (${Date.now() - startedAt}ms, ${pdfBuf.length} bytes): ${id}.${ext}`);
      return { status: 200, body: { success: true, pdfBase64: pdfBuf.toString("base64") } };
    }

    const text = fs.readFileSync(outPath, "utf8");
    if (!text || text.trim().length === 0) {
      console.log(`[convert:text] 빈 결과 (${Date.now() - startedAt}ms): ${id}.${ext}`);
      return { status: 200, body: { success: false, reason: "empty_output" } };
    }
    console.log(`[convert:text] 완료 (${Date.now() - startedAt}ms, ${text.length}자): ${id}.${ext}`);
    return { status: 200, body: { success: true, text } };
  } catch (e) {
    console.error(`[convert:${format}] 오류 (${Date.now() - startedAt}ms): ${id}.${ext} -`, e?.message || e);
    return { status: 500, body: { success: false, reason: "conversion_error", message: e?.message || String(e) } };
  } finally {
    try { fs.unlinkSync(inPath); } catch { /* 무시 */ }
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* 무시 */ }
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`hwp-worker listening on :${PORT}`);
});
