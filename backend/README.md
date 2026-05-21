# M2SOFT SFA Backend

사내 PC에서 직접 실행하는 자료실 백엔드입니다. 데이터는 DB 없이 CSV + 로컬 파일로 관리합니다.

## 실행

```bash
cd backend
npm install
npm start            # 포트 4000
# 또는: PORT=5000 APP_PASSWORD=mypw npm start
```

- Node.js 18 이상 필요
- 실행 시 `backend/data/presentations.csv` 와 `backend/uploads/` 가 자동 생성됩니다.
- 업로드된 원본 파일은 모두 `backend/uploads/` 에 저장됩니다.
- 메타데이터는 `backend/data/presentations.csv` 에 한 줄씩 기록됩니다.

## 환경변수

| 이름           | 기본값  | 설명                              |
| -------------- | ------- | --------------------------------- |
| `PORT`         | `4000`  | 백엔드 HTTP 포트                  |
| `APP_PASSWORD` | `2188`  | 로그인 / 업로드 / 삭제용 비밀번호 |

## 프론트엔드 연결

프론트엔드 빌드 시 `VITE_API_BASE` 를 백엔드 PC 주소로 지정하세요.

```
VITE_API_BASE=http://192.168.0.10:4000
```

같은 PC에서 둘 다 실행하면 기본값(`http://localhost:4000`) 으로 동작합니다.

## API

| Method | Path                          | 설명                                      |
| ------ | ----------------------------- | ----------------------------------------- |
| POST   | `/api/login`                  | `{password}` 검증                         |
| GET    | `/api/presentations`          | 전체 목록 JSON                            |
| POST   | `/api/presentations`          | multipart/form-data (file 또는 url) 등록  |
| DELETE | `/api/presentations/:id`      | 항목 + 파일 삭제                          |
| GET    | `/api/files/:id`              | 업로드 원본 파일 스트리밍                 |
| GET    | `/api/health`                 | 헬스체크                                  |

업로드/삭제는 헤더 `x-app-password` 가 필요합니다.

## 방화벽

다른 PC에서 접속하려면 백엔드 PC 방화벽에서 `PORT`(기본 4000) 인바운드 허용이 필요합니다.