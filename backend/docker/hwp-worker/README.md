# hwp-worker 로컬 테스트 가이드 (Rocky Linux WSL2)

이 폴더는 마이그레이션 1단계("로컬에서 컨테이너 1개만 띄워 테스트")를 위한 것입니다.
아래 순서대로 진행하시면 됩니다. 모든 명령어는 **Windows가 아니라 Rocky Linux WSL2 터미널**
안에서 실행합니다.

## 0. Docker Engine 설치 (Rocky Linux WSL2 안에서)

먼저 systemd가 활성화되어 있는지 확인합니다.

```bash
ps --pid 1 -o comm=
```

`systemd`라고 나오면 이미 활성화된 것이니 바로 아래 "설치"로 넘어가면 됩니다.
다른 게 나오면(`init` 등) 활성화가 필요합니다.

```bash
sudo tee /etc/wsl.conf > /dev/null <<'EOF'
[boot]
systemd=true
EOF
```

그다음 **Windows PowerShell**에서:

```powershell
wsl --shutdown
```

몇 초 기다렸다가 Rocky Linux를 다시 열면 systemd가 켜져 있습니다.

### 설치

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

마지막 줄(그룹 추가) 이후엔 **터미널을 완전히 닫고 새로 열어야** 적용됩니다 (또는 `newgrp docker`).

### 확인

```bash
docker --version
docker compose version
docker run hello-world
```

`hello-world`가 정상 출력되면 준비 완료입니다.

## 1. H2Orestart.oxt 준비

라이선스상 이 파일은 저장소에 포함하지 않았습니다. 로컬 PC에 이미 설치해두신 것과 동일한
`H2Orestart.oxt` 파일을 이 폴더(`Dockerfile`과 같은 위치)에 `H2Orestart.oxt`라는 이름으로
복사해주세요. (원본: https://github.com/ebandal/H2Orestart 릴리스 페이지)

## 2. 빌드 & 실행

이 폴더(`docker-compose.yml`이 있는 위치)에서:

```bash
docker compose build --no-cache
docker compose up -d
docker compose ps
```

`healthy` 상태가 되기까지 최초 기동 시 몇 초~수십 초 걸릴 수 있습니다 (LibreOffice 첫 구동).

## 3. 워커 단독 테스트 (server.js 연동 전에 먼저 확인)

예전에 타임아웃 났던 문제 파일 하나를 이 컨테이너로 직접 보내서 결과를 확인해봅니다.
(파일 경로는 실제 hwp/hwpx 파일로 바꿔주세요)

```bash
curl -X POST "http://localhost:4101/convert?ext=hwp" \
  --data-binary @/path/to/problem-file.hwp \
  -H "Content-Type: application/octet-stream"
```

`{"success":true,"text":"..."}` 형태로 나오면 성공입니다. 두 번째 워커도 같은 방식으로
`localhost:4102`에 테스트해볼 수 있습니다.

Windows 쪽에서도 (PowerShell 또는 브라우저로) `http://localhost:4101/health` 접속이
되는지 확인해보세요 — WSL2 localhost 포워딩이 정상 동작하는지 확인하는 용도입니다.

## 4. 다음 단계

여기까지 확인되면, server.js에 `HWP_WORKER_URLS` 연동 코드를 추가해드리겠습니다
(기존 로컬 LibreOffice 경로는 폴백으로 남겨두는 feature-flag 방식). 이 README의 3번까지
문제없이 되는지 먼저 확인 부탁드립니다.
