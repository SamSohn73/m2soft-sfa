
# 사내 백엔드 서버 + CSV 자료 관리 구조 전환

현재 `localStorage` 기반 단일 페이지를 **별도 Node 서버 + 프론트엔드** 구조로 분리하고, 모든 자료는 사내 PC의 디스크에 저장합니다.

## 1. 새 백엔드 (`backend/` 폴더, 프로젝트 루트)

기존 `src/server.ts`(TanStack SSR)와 충돌하지 않도록 별도 폴더 `backend/`에 독립 Express 서버를 만듭니다.

```
backend/
  package.json          # express, multer, cors, csv-parse, csv-stringify
  server.js             # Express 진입점
  data/
    presentations.csv   # 메타데이터 (자동 생성)
  uploads/              # 실제 파일 (자동 생성)
```

**CSV 컬럼**: `id,name,category,sourceType,src,mime,fileName,createdAt`
- `sourceType=file` 일 때 `src`는 서버의 상대 경로 (예: `uploads/<id>.<ext>`)
- `sourceType=url` 일 때 `src`는 입력된 URL 원본

**API**:
- `POST /api/login` — body `{password}` → `{ok:true}` / 401
- `GET  /api/presentations` — 전체 목록 JSON
- `POST /api/presentations` — `multipart/form-data` (file/url 둘 다 처리). `x-app-password` 헤더 검증
- `DELETE /api/presentations/:id` — CSV 행 + 파일 삭제. 헤더 검증
- `GET  /api/files/:id` — 원본 파일 다운로드/뷰어용 (Content-Type 포함)
- CORS 허용, 비밀번호는 환경변수 `APP_PASSWORD`(기본 `2188`), 포트 `PORT`(기본 `4000`)

**실행**: `cd backend && npm install && npm start`

## 2. 프론트엔드 수정

**`src/lib/store.ts` 전면 교체**: localStorage → API fetch
- `VITE_API_BASE` 환경변수 (기본 `http://localhost:4000`)
- `login(pwd)`, `getPresentations()`(async), `addPresentation(formData)`, `removePresentation(id)`
- 비밀번호와 인증 상태는 sessionStorage에 보관 (서버 호출 시 헤더로 전달)
- 변경 알림은 기존 `m2:presentations` 이벤트 유지

**`src/components/UploadModal.tsx`**: FileReader/dataURL 제거 → `FormData`로 백엔드에 전송

**`src/components/Sidebar.tsx`, `src/routes/main.tsx`**: `getPresentations` async 사용으로 작은 수정 (useEffect에서 await/setState)

**`src/lib/viewer.ts`**: 파일은 이제 백엔드 URL(`/api/files/:id`)로 직접 로드되므로 그대로 잘 동작 (data URL → http URL로 바뀜)

**`src/routes/index.tsx`**: 로그인 시 `/api/login` 호출로 검증

**`PasswordModal.tsx`**: 서버 비밀번호 변경은 별도 구현 범위가 크므로 이번 단계에서는 비활성/안내 처리

## 3. 환경변수

루트에 `.env.example` 추가:
```
VITE_API_BASE=http://localhost:4000
```
프론트 빌드 시 사용. 백엔드는 자체 `backend/.env` (`APP_PASSWORD`, `PORT`).

## 4. 안내 사항 (README 짧게)

`backend/README.md`에 다음 내용 기입:
- Node 18+ 필요
- `npm install` → `npm start`
- uploads/, data/ 폴더 자동 생성
- 방화벽에서 포트 4000 허용
- 프론트는 `VITE_API_BASE`를 백엔드 PC의 IP로 설정 (예: `http://192.168.0.10:4000`)

## 기술 메모

- 기존 `src/server.ts`(TanStack SSR entry) 와 `vite.config.ts`의 `tanstackStart.server.entry`는 **그대로 둠** — 우리가 만드는 백엔드는 완전히 분리된 프로세스
- CSV는 동시 쓰기 보호를 위해 간단한 in-memory mutex(Promise 직렬화) 적용
- 파일명 충돌 방지: 저장 시 `<uuid>.<원본확장자>`
- 기존 localStorage 데이터는 마이그레이션 없이 폐기 (사용자 합의 가정)

진행해도 될까요?
