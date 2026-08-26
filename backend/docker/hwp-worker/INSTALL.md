# hwp-worker 설치 매뉴얼 (다른 장비에 배포할 때)

이 문서는 로컬 PC에서 검증이 끝난 hwp-worker를 **다른 장비(개발/운영 서버 등)에 새로
설치**할 때 사용하는 매뉴얼입니다. 로컬 Windows+WSL2에서의 최초 셋업 과정은
`README.md`를 참고하시고, 이 문서는 "이미 Docker가 익숙한 환경에 배포"하는 것을
기준으로 좀 더 간결하게 정리했습니다.

## 0. 사전 준비물

- Docker Engine + Docker Compose 플러그인이 설치되어 있어야 합니다 (`docker --version`,
  `docker compose version`으로 확인). 개발/운영 서버는 이미 다른 서비스를 Docker로
  띄우고 있다면 대부분 이 단계는 이미 되어 있을 겁니다.
  - 안 되어 있다면(Rocky/CentOS 계열 기준):
    ```bash
    sudo dnf -y install dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
    sudo usermod -aG docker $USER   # 이후 터미널 재접속 필요
    ```
- `H2Orestart.oxt` 파일 — 라이선스상 저장소에 포함되어 있지 않습니다. 로컬에서
  검증할 때 쓴 것과 동일한 파일을 직접 준비해야 합니다
  (https://github.com/ebandal/H2Orestart 릴리스 페이지에서 받을 수 있습니다).

## 1. 파일 배치

이 저장소를 서버에 clone/pull한 뒤, `backend/docker/hwp-worker/` 폴더로 이동합니다.

```bash
cd backend/docker/hwp-worker
```

준비해둔 `H2Orestart.oxt`를 이 폴더(= `Dockerfile`과 같은 위치)에 그대로 복사해
넣습니다. `problem.hwp`, `problem2.hwpx` 같은 테스트 파일은 저장소에 없으니 신경
쓰지 않으셔도 됩니다(로컬 디버깅용으로만 쓰던 파일이라 `.gitignore`로 제외되어
있습니다).

## 2. 워커 개수 정하기

`docker-compose.yml`을 열어서 이 서버에 맞는 개수만큼 `hwp-worker-N` 서비스가
있는지 확인합니다. 기본으로 들어있는 개수보다 늘리거나 줄이려면, 기존 서비스
블록을 복사해서 이름(`hwp-worker-N`)과 호스트 포트(`41NN:4100`)만 바꿔주면
됩니다 — 컨테이너 내부 포트(4100)는 항상 고정입니다.

```yaml
  hwp-worker-11:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "4111:4100"
```

**개수를 얼마로 할지**: 이 서버의 논리 코어 수(`nproc`)를 먼저 확인하고, 그 서버에서
이미 돌고 있는 다른 서비스들의 몫을 뺀 나머지 정도로 시작하시길 권장합니다. 워커
하나가 변환 작업 중엔 대략 코어 하나를 쓴다고 보면 됩니다. 다만 저희가 실제로
겪어본 바로는 CPU/메모리가 넉넉한데도 특정 "말썽 파일" 때문에 개별 작업이 오래
걸리는 경우가 있었고, 그건 워커 개수와 무관한 문제였습니다 — 아래 6번 참고.

## 3. 빌드 & 실행

```bash
docker compose build
docker compose up -d
docker compose ps
```

`STATUS`가 `healthy`로 뜨기까지 최초 기동 시 몇 초~수십 초 걸릴 수 있습니다
(LibreOffice 폰트 캐시 생성 때문). 빌드 도중 H2Orestart 확장 등록이 실패하면
(`is registered: no`) 빌드 자체가 중단되도록 되어 있으니, 빌드가 실패했다면
`H2Orestart.oxt` 파일이 올바른 위치에 있는지, 손상되지 않았는지부터 확인하세요.

## 4. 동작 확인

```bash
curl http://localhost:4101/health
# {"status":"ok"} 가 나오면 정상

curl -X POST "http://localhost:4101/convert?ext=hwp" \
  --data-binary @/path/to/test.hwp \
  -H "Content-Type: application/octet-stream" \
  -w "\n소요시간: %{time_total}초\n"
# {"success":true,"text":"..."} 가 나오면 정상
```

띄운 워커 개수만큼 포트를 바꿔가며(4101, 4102, ...) 전부 확인해보시길 권장합니다.

## 5. 메인 서버(server.js) 연동

이 서버의 `backend/.env`에 워커 URL 목록을 콤마로 구분해서 넣습니다.

```
HWP_WORKER_URLS=http://localhost:4101,http://localhost:4102,http://localhost:4103
```

- 이 값을 넣지 않으면(주석 처리 등) 기존처럼 이 서버에 설치된 로컬 LibreOffice를
  직접 실행하는 방식으로 동작합니다 — 워커가 아직 준비 안 됐거나 문제가 생겨도
  자동수집 자체가 멈추지는 않는 폴백 경로입니다.
- `.env`는 서버가 시작될 때 한 번만 읽으므로, 값을 바꾼 뒤에는 **백엔드 서버를
  재시작**해야 반영됩니다. 재시작 전에는 자동수집이 실행 중인지 먼저 확인하시길
  권장합니다.
- 워커 여러 개를 라운드로빈으로 돌려쓰고, 공고 여러 건을 동시에 처리해 워커
  개수만큼 실제로 병렬 처리되도록 되어 있습니다 — 워커를 늘렸는데 체감 속도가
  그대로라면 `server.js`의 `runG2bCrawlRule` 함수가 이 저장소의 최신 버전인지부터
  확인하세요(예전 버전은 첨부파일을 한 번에 하나씩만 순차 처리했습니다).

## 6. 타임아웃 값 (SOFFICE_TIMEOUT_MS)

`worker/index.js`에 `SOFFICE_TIMEOUT_MS = 60000`(60초)으로 설정되어 있습니다.
실제 운영에서 관찰한 결과, 정상적으로 변환되는 hwp/hwpx는 거의 다 수 초~10초
안에 끝나고, 반대로 LibreOffice 변환 필터에서 막히는 파일은 몇 분을 줘도 결국
실패로 끝났습니다 — 그래서 240초에서 60초로 줄여, "말썽 파일" 하나가 워커
슬롯을 오래 붙잡고 있는 시간을 줄였습니다.

이 값을 바꾸려면 **네 곳을 함께 맞춰야** 합니다(하나만 바꾸면 서로 안 맞습니다).

1. `worker/index.js`의 `SOFFICE_TIMEOUT_MS` — 워커 자체의 변환 제한 시간
2. `server.js`의 `extractHwpTextViaWorker` 안 axios `timeout` — 위 값보다
   10~20초 정도 여유를 둔 값(워커 자신의 타임아웃 응답이 돌아올 시간을 줌)
3. `server.js`의 `SOFFICE_TIMEOUT_MS` — 로컬 LibreOffice 폴백 경로용(1과 동일 값 권장)
4. `worker/index.js`를 고쳤다면 **`docker compose up -d --build`로 재빌드**해야
   반영됩니다 — `server.js`만 고치는 것과 달리, 코드가 이미지 안에 구워지기
   때문입니다.

## 7. 알려진 문제와 원인 (트러블슈팅)

- **첫 빌드 후 계속 타임아웃난다**: `docker compose exec <서비스명> unopkg list --shared`로
  H2Orestart가 `is registered: yes`인지 확인하세요. `no`라면 확장이 파일만
  들어가고 등록은 안 끝난 상태입니다 — 이 Dockerfile은 `--terminate_after_init`
  옵션으로 이 문제를 피하도록 이미 되어 있으니, 혹시 Dockerfile을 직접
  수정하셨다면 이 부분을 건드리지 않았는지 확인하세요.
- **빌드 자체가 Java 관련 오류로 실패한다**
  (`[JavaVirtualMachine] An unexpected error occurred while searching for a Java`):
  `libreoffice-java-common` 패키지가 빠진 경우입니다. `default-jre-headless`만으로는
  LibreOffice가 설치된 JRE를 못 찾습니다.
- **CPU/메모리는 멀쩡한데 특정 파일만 계속 느리다/타임아웃난다**: 자원 경합이
  아니라 그 파일 자체가 LibreOffice 변환 필터에서 오래 걸리는 유형일 가능성이
  높습니다. 부하가 전혀 없는 워커 하나에 그 파일만 단독으로 보내봐서(4번의 curl
  명령 활용) 그래도 똑같이 오래 걸리면 파일 문제로 확정할 수 있습니다.
- **워커를 늘렸는데 체감 속도가 그대로다**: 5번에서 언급한 대로, 메인 서버가
  공고를 정말 동시에 여러 개 처리하고 있는지 확인하세요. 순차 처리 코드라면
  워커가 몇 개든 항상 하나만 쓰입니다.
