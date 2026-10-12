# Uranus-NetTools

**CLI-based Network Toolkit Powered by Uranus**

[English](README.md) | 한국어

[![CI](https://github.com/JAEJUN090210/Uranus-NetTools/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/JAEJUN090210/Uranus-NetTools/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Uranus-NetTools(`unt`)는 Windows, Linux, macOS에서 동작하는 커맨드라인 네트워크 도구 모음입니다. 자주 쓰는 진단, 스캔, 조회 도구를 하나의 일관된 인터페이스로 묶었습니다. 명령을 한 번씩 실행할 수도 있고, 대화형 셸에 들어가 이어서 입력할 수도 있습니다. TypeScript와 Node.js로 만듭니다.

> [!NOTE]
> 아직 초기 개발 단계이며 정식 릴리즈 전입니다. 아래 명령과 옵션은 첫 릴리즈(v1.0.0) 전에 바뀔 수 있습니다.

## 기능

| 분류 | 도구 |
| --- | --- |
| **연결 진단** | ping(시스템 ICMP 또는 TCP 핸드셰이크), traceroute, TCP 포트 연결 확인, 지연시간 측정 |
| **스캔** | TCP connect 포트 스캔, LAN 호스트 탐색(서브넷 스윕), 서비스 배너 확인 |
| **조회** | DNS 레코드(A, AAAA, MX, TXT 등), WHOIS, IP 위치와 ASN, HTTP 헤더, TLS 인증서 |
| **로컬 정보** | 네트워크 인터페이스와 주소, 공인 IP, 기본 게이트웨이, 현재 연결과 대기 중인 포트 |

- **두 가지 실행 방식**: 스크립트와 파이프에 쓰기 좋은 서브커맨드, 입력 기록이 남는 대화형 셸
- **사람도 기계도 읽기 쉬운 출력**: 기본은 컬러 표, 스크립트용으로는 `--json`
- **ping에 관리자 권한 불필요**: raw 소켓 대신 시스템 `ping` 명령이나 TCP 핸드셰이크를 사용
- **크로스플랫폼**: Windows, Linux, macOS

## 사용법 (미리보기)

```console
$ unt ping google.com
$ unt scan 192.168.0.1 -p 1-1024
$ unt dns example.com --type MX
$ unt local

$ unt
unt ❯ ping 8.8.8.8
unt ❯ exit
```

### 공통 옵션

| 옵션 | 설명 |
| --- | --- |
| `--json` | 스크립트에서 쓰기 좋게 결과를 JSON으로 출력 |
| `-q, --quiet` | 안내 문구 없이 결과만 출력 |
| `--verbose` | 실행한 시스템 명령 같은 내부 동작을 자세히 출력 |
| `-V, --version` | 버전 출력 |
| `-h, --help` | 도움말 출력 |

출력이 터미널이 아니거나 `NO_COLOR` 환경 변수가 있으면 색이 자동으로 꺼집니다.

### 대화형 셸

인자 없이 `unt`를 실행하면 대화형 셸이 열립니다. 모든 명령을 커맨드라인에서와 똑같이 쓸 수 있습니다.

- `Tab`으로 명령 이름과 옵션을 완성합니다.
- `help [명령]`은 도움말, `clear`는 화면 지우기, `exit`이나 `quit`은 셸 종료입니다.
- `Ctrl+C`는 셸을 끝내지 않고 실행 중인 명령만 취소합니다. 빈 줄에서 두 번 누르거나 `Ctrl+D`를 누르면 종료합니다.

## 설치

아래 패키지 매니저로 배포할 예정입니다.

| 플랫폼 | 패키지 매니저 | 상태 |
| --- | --- | --- |
| Ubuntu | apt | 예정 |
| macOS | Homebrew | 예정 |
| Windows | winget | 예정 |

## 소스에서 빌드하기

첫 릴리즈 전까지는 소스를 직접 빌드해 실행할 수 있습니다. Node.js 22.13 이상이 필요합니다.

```console
$ git clone https://github.com/JAEJUN090210/Uranus-NetTools.git
$ cd Uranus-NetTools
$ npm install
$ npm run build
$ node dist/unt.cjs --help
```

빌드 후 `npm link`를 실행하면 어디서나 `unt` 명령을 쓸 수 있습니다.

## 책임 있는 사용

스캔과 탐지 도구를 내가 관리하지 않는 시스템에 사용하면 네트워크 장애를 일으키거나 법과 정책을 위반할 수 있습니다. 직접 소유했거나 명시적으로 허가받은 호스트와 네트워크에만 사용하세요.

## 기여하기

기여를 환영합니다. 이슈나 PR을 올리기 전에 아래 문서를 읽어주세요.

- [CONTRIBUTING.md](CONTRIBUTING.md): 개발 프로세스, 이슈와 라벨, 브랜치, PR, 버전 규칙
- [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md): 커밋 메시지 규칙

## 라이선스

Copyright (C) 2026 JAEJUN JEON

Uranus-NetTools는 [GNU General Public License v3.0](LICENSE)에 따라 배포되는 자유 소프트웨어입니다.
