// ══════════════════════════════════════════════════════════════
// hwp 파싱 전용 워커 프로세스
// ──────────────────────────────────────────────────────────────
// @ohah/hwpjs 의 Rust 코어가 일부 파손되거나 특이한 구조의 hwp 파일을
// 만나면 panic으로 프로세스 전체가 죽는 문제가 있어, 이 스크립트를
// 별도의 자식 프로세스로 실행함으로써 크래시가 나도 메인 서버(Express)에
// 영향을 주지 않도록 격리한다.
//
// 사용법: node hwp_worker.js <hwp파일경로>
// 결과는 stdout에 JSON 한 줄로 출력: { ok: true, text: "..." } 또는 { ok: false, error: "..." }
// ══════════════════════════════════════════════════════════════

import * as hwpjs from "@ohah/hwpjs";
import fs from "fs";

const filePath = process.argv[2];

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

try {
  if (!filePath || !fs.existsSync(filePath)) {
    output({ ok: false, error: "file not found" });
    process.exit(0);
  }
  const buf = fs.readFileSync(filePath);
  const result = hwpjs.toMarkdown(buf);
  const text = result?.markdown || result?.content || String(result || "");
  output({ ok: true, text });
  process.exit(0);
} catch (e) {
  output({ ok: false, error: e?.message || String(e) });
  process.exit(0);
}
