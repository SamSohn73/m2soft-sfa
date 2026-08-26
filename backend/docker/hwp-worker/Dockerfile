# hwp-worker: hwp/hwpx 첨부파일을 텍스트로 변환해주는 워커 컨테이너.
# LibreOffice + H2Orestart 확장(한글 hwp/hwpx 지원)이 이미지 빌드 시점에 미리 설치되어 있어,
# 컨테이너가 몇 번을 재시작해도 다시 설치할 필요가 없다.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-draw \
      libreoffice-java-common \
      fonts-nanum \
      fontconfig \
      default-jre-headless \
      curl unzip procps \
      nodejs npm \
    && rm -rf /var/lib/apt/lists/*
# libreoffice-java-common: default-jre-headless로 Java 실행 파일 자체는 깔려도,
# LibreOffice가 그 Java를 실제로 찾아서 쓰도록 연결해주는(jvmfwk 설정) 패키지가 따로
# 필요하다. 이게 없으면 H2Orestart의 Java 컴포넌트(H2Orestart.jar) 등록 시점에
# "[JavaVirtualMachine] An unexpected error occurred while searching for a Java" 로
# unopkg add 자체가 실패한다 (실제로 겪은 문제).

# 컨테이너 첫 구동 때 폰트 캐시를 새로 만드느라(fc-cache) soffice가 오래 멈춰있는 것처럼
# 보이는 경우가 흔해서, 빌드 시점에 미리 캐시를 만들어 이미지에 구워둔다.
RUN fc-cache -f -v

# H2Orestart 확장을 이미지 빌드 시점에 "공유(--shared)"로 한 번만 설치한다.
# --shared로 설치하면 컨테이너 안에서 새 프로필이 만들어져도(soffice를 몇 번을 다시 띄우든)
# 항상 이 확장이 남아있다 — 예전에 "-env:UserInstallation으로 매번 새 프로필을 쓰는 방식"이
# 실패했던 이유(새 프로필엔 확장이 없어 hwp/hwpx를 못 열었을 가능성)를 이 방식으로 피한다.
#
# 중요: unopkg add는 soffice가 "실행 중이 아닐 때" 호출해야 하고, 확장을 추가한 뒤에는
# soffice를 한 번 더(깨끗하게) 실행해줘야 "등록(register)"까지 완료된다 — 그냥 add만 하면
# 파일은 들어가지만 등록은 다음 실행 때 완료되는데, 예전 방식(백그라운드로 띄워둔 채 add하고
# 강제 kill)은 그 "다음 실행"의 기회 자체를 준 적이 없어서 등록이 영영 끝나지 않았다
# (unopkg list --shared로 확인해보면 "is registered: no"로 나옴 — 실제로 겪은 문제).
# --terminate_after_init은 초기화(대기 중인 확장 등록 포함)를 마치고 나면 스스로 깨끗하게
# 종료해주는 옵션이라, 강제 kill 없이도 등록을 확실히 끝낼 수 있고 잠금파일(.lock) 걱정도 없다.
#
# ※ H2Orestart.oxt 파일은 라이선스상 이 저장소에 커밋하지 않는다. 이 Dockerfile과 같은
#   디렉터리(docker/hwp-worker/)에 H2Orestart.oxt를 직접 받아서 넣어둔 뒤 빌드해야 한다.
#   (https://github.com/ebandal/H2Orestart 릴리스 페이지에서 받을 수 있다 — 로컬 PC에
#    이미 설치되어 있는 것과 동일한 파일을 그대로 복사해서 써도 된다.)
COPY H2Orestart.oxt /opt/H2Orestart.oxt
RUN soffice --headless --nolockcheck --terminate_after_init \
    && unopkg add --shared /opt/H2Orestart.oxt \
    && soffice --headless --nolockcheck --terminate_after_init \
    && unopkg list --shared | tee /tmp/unopkg-list.txt \
    && if grep -q "is registered: no" /tmp/unopkg-list.txt; then \
         echo "!!! H2Orestart 확장이 등록되지 않았습니다 — 빌드 중단 !!!" >&2; exit 1; \
       fi

WORKDIR /app
COPY worker/package.json ./
RUN npm install --omit=dev
COPY worker/index.js ./

EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4100/health || exit 1

CMD ["node", "index.js"]
