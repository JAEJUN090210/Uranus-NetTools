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

## 명령

### ping

호스트가 응답하는지, 얼마나 빠른지 확인합니다. ICMP는 시스템 `ping` 명령을 쓰므로 관리자 권한이 필요 없습니다. ICMP가 막힌 곳에서는 `--tcp`로 TCP 연결 시간을 대신 잽니다.

```console
$ unt ping google.com                    # 4번 전송
$ unt ping google.com -t                 # Ctrl+C까지 계속
$ unt ping example.com --tcp             # TCP 443 포트
$ unt ping example.com -p 22             # TCP 22 포트
$ unt ping google.com 1.1.1.1 8.8.8.8    # 여러 호스트를 표로 비교
```

| 옵션 | 설명 |
| --- | --- |
| `-c, --count <n>` | 호스트마다 보낼 횟수 (기본값: 4) |
| `-t, --continuous` | Ctrl+C를 누를 때까지 계속 전송 |
| `-i, --interval <seconds>` | 전송 간격(초) (기본값: 1) |
| `-W, --timeout <ms>` | 응답을 기다리는 시간 (기본값: 2000) |
| `--tcp` | ICMP 대신 TCP 연결 시간을 측정 |
| `-p, --port <port>` | TCP 포트, `--tcp` 포함 (기본값: 443) |
| `-4, --ipv4` / `-6, --ipv6` | IPv4 또는 IPv6만 사용 |

요약에는 손실률, 최소/평균/최대, 지터, p95, 응답 시간 스파크라인이 나옵니다. 응답을 하나도 받지 못한 호스트가 있으면 종료 코드는 1입니다.

### trace

목적지까지 거치는 경유지와 경유지별 응답 시간을 보여줍니다. Windows는 `tracert`, macOS·Linux는 `traceroute`를 실행하고, traceroute가 없는 Linux에서는 `tracepath`로 대신합니다.

```console
$ unt trace google.com          # 호스트 이름 포함
$ unt trace google.com -n       # IP만 표시, 더 빠름
$ unt trace 1.1.1.1 -m 15       # 15홉까지만
$ unt trace google.com --watch  # mtr처럼 경유지를 계속 측정 (Ctrl+C로 멈춤)
$ unt trace google.com -c 20    # 20라운드 측정 후 표 출력
```

| 옵션 | 설명 |
| --- | --- |
| `-m, --max-hops <n>` | 최대 홉 수 (기본값: 30) |
| `-W, --timeout <ms>` | 응답을 기다리는 시간 (기본값: 2000) |
| `-n, --numeric` | 호스트 이름을 조회하지 않고 IP만 표시 |
| `-4, --ipv4` / `-6, --ipv6` | IPv4 또는 IPv6만 사용 |
| `--watch` | 경유지를 계속 측정하며 표를 실시간으로 갱신 |
| `-c, --count <rounds>` | watch 모드에서 측정할 라운드 수, `--watch` 포함 |
| `-i, --interval <seconds>` | watch 모드의 라운드 간격(초) (기본값: 1), `--watch` 포함 |

경유지는 끝나는 대로 한 줄씩 출력됩니다. 목적지에 닿지 못하면 종료 코드는 1입니다.

`--watch`는 Windows의 `pathping`처럼 경로를 한 번 찾은 뒤 라운드마다 모든 경유지에 ping을 보내고, 경유지별 손실률과 최근·평균·최소·최대 응답 시간을 보여줍니다. 라우터는 트래픽을 정상적으로 전달하면서도 ping에는 늦게 답하거나 답하지 않는 경우가 많습니다. 그래서 중간 경유지의 손실은 그 뒤 경유지들까지 이어질 때만 의미가 있습니다.

### scan

호스트에서 열려 있는 TCP 포트를 찾습니다. 포트마다 TCP 연결을 끝까지 맺어 보는 방식(connect 스캔)이라 관리자 권한이 필요 없습니다. 기본으로 [Nmap](https://nmap.org)이 기본 검사하는 포트 1000개를 한 번에 500개씩 확인합니다.

```console
$ unt scan 192.168.0.1                # 자주 쓰는 포트 1000개
$ unt scan 192.168.0.1 -p 22,80,443   # 지정한 포트만
$ unt scan 192.168.0.1 -p 1-1024      # 범위
$ unt scan 192.168.0.1 -p -           # 모든 포트 (1-65535)
$ unt scan 192.168.0.1 --banner       # 서비스가 밝히는 정보도 표시
$ unt scan 192.168.0.1 --all          # 닫힌 포트와 필터링된 포트도 표시
```

| 옵션 | 설명 |
| --- | --- |
| `-p, --ports <list>` | 검사할 포트, `22,80,443`이나 `1-1024`처럼 지정하고 `-`는 전체 (기본값: 자주 쓰는 포트 1000개) |
| `-a, --all` | 닫힌 포트와 필터링된 포트도 표시 |
| `-b, --banner` | 열린 포트가 스스로 밝히는 정보 읽기 |
| `-y, --yes` | 공인 주소도 묻지 않고 검사 |
| `-W, --timeout <ms>` | 포트마다 기다리는 시간 (기본값: 1500) |
| `--concurrency <n>` | 동시에 시도할 포트 수 (기본값: 500) |
| `-4, --ipv4` / `-6, --ipv6` | IPv4 또는 IPv6만 사용 |

연결을 받아 주면 **open**(열림), 호스트가 거부하면 **closed**(닫힘), 시간 안에 아무 응답이 없으면 **filtered**(필터링)입니다. filtered는 대개 방화벽이 연결을 버리는 경우입니다. 표에는 열린 포트만 나오고 나머지는 요약에 개수로 나옵니다. Ctrl+C를 누르면 검사를 멈추고 그때까지 찾은 결과를 보여줍니다.

`--banner`를 주면 SSH, FTP, SMTP처럼 서버가 먼저 보내는 인사말을 기다리고, 인사말이 없으면 HTTP `HEAD` 요청을 보내 상태 줄과 `Server` 헤더를 보여줍니다. TLS도 시도하므로 흔하지 않은 포트의 HTTPS도 TLS 버전과 함께 나오고, MySQL 서버는 버전이 나옵니다.

공인 주소(사설망, 루프백 등 예약된 대역이 아닌 주소)는 남의 시스템일 수 있으므로 검사 전에 확인을 받습니다. 스크립트에서는 `--yes`로 질문을 건너뛸 수 있고, 물어볼 터미널이 없으면 `--yes` 없이는 공인 주소를 검사하지 않습니다. [책임 있는 사용](#책임-있는-사용)을 참고하세요.

기본 포트 목록은 Nmap의 `--top-ports 1000`과 같으며 Nmap `nmap-services`의 빈도 정보로 계산했습니다. 서비스 이름은 [IANA 포트 등록부](https://www.iana.org/assignments/service-names-port-numbers/)를 따릅니다.

### sweep

같은 네트워크(LAN)에서 응답하는 호스트를 찾습니다. 주소마다 ping(ICMP)을 보내고, ping에 답하지 않는 호스트는 흔한 TCP 포트에 연결을 시도하며, 운영체제의 ARP 테이블을 읽어 조용하지만 연결돼 있는 호스트까지 찾습니다. 관리자 권한이 필요 없습니다.

```console
$ unt sweep                      # 이 컴퓨터가 속한 서브넷
$ unt sweep 192.168.0.0/24       # 특정 네트워크
$ unt sweep 192.168.0.1-50       # 범위
$ unt sweep 10.0.0.0/24 --no-hostnames   # 이름 조회 생략, 더 빠름
```

| 옵션 | 설명 |
| --- | --- |
| `-W, --timeout <ms>` | 각 탐색을 기다리는 시간 (기본값: 1000) |
| `--concurrency <n>` | 동시에 탐색할 호스트 수 (기본값: 64) |
| `--no-hostnames` | 호스트 이름을 조회하지 않음 (더 빠름) |
| `-y, --yes` | 공인 범위도 묻지 않고 검사 |

범위 없이 실행하면 이 컴퓨터가 속한 서브넷을 검사합니다. CIDR 블록(`192.168.0.0/24`), 범위(`192.168.0.1-50` 또는 `192.168.0.1-192.168.0.50`), 단일 주소를 지정할 수 있습니다. 한 번에 최대 65,536개 주소(`/16`)까지 검사하며, 더 큰 네트워크는 여러 번 나눠 실행합니다.

호스트마다 이름, MAC 주소, 제조사, 응답 시간을 보여줍니다. 이름은 역방향 DNS, NetBIOS(주로 Windows PC), mDNS(Apple 기기·프린터 등이 쓰는 `.local` 이름) 중 먼저 답하는 것을 씁니다. MAC 주소와 제조사는 ARP 테이블에서 읽으므로 같은 LAN에 있는 호스트에만 나옵니다. 제조사는 [IEEE OUI 등록부](https://standards.ieee.org/products-programs/regauth/)를 내장해 조회하므로 인터넷 없이도 동작합니다. 무작위(사생활 보호) MAC 주소를 쓰는 기기는 제조사가 나오지 않습니다.

공인 범위(사설망·루프백 등 예약된 대역이 아닌 주소)는 남의 시스템일 수 있으므로 검사 전에 확인을 받습니다. 스크립트에서는 `--yes`로 질문을 건너뛸 수 있고, 물어볼 터미널이 없으면 `--yes` 없이는 공인 범위를 검사하지 않습니다. [책임 있는 사용](#책임-있는-사용)을 참고하세요. Ctrl+C를 누르면 검사를 멈추고 그때까지 찾은 결과를 보여줍니다.

### dns

도메인의 DNS 레코드를 조회합니다. `--type`을 주지 않으면 흔히 필요한 레코드(A, AAAA, CNAME, MX, NS, TXT, SOA, CAA)를 한 번에 조회하고 TTL을 함께 보여줍니다. IP 주소를 주면 역방향(PTR) 조회를 합니다.

```console
$ unt dns example.com                  # 주요 레코드
$ unt dns example.com -t MX -t TXT     # 지정한 타입만
$ unt dns 8.8.8.8                      # 역방향 조회
$ unt dns example.com --server 9.9.9.9 # 특정 서버에 질의
$ unt dns example.com --compare        # 여러 서버의 답 비교
$ unt dns example.com --trace          # 루트부터 위임 경로 추적
```

| 옵션 | 설명 |
| --- | --- |
| `-t, --type <types...>` | 조회할 레코드 타입 (기본값: 주요 레코드) |
| `-s, --server <address>` | 시스템 DNS 대신 물어볼 서버의 IP 주소 |
| `--compare` | 시스템 DNS와 공개 DNS의 답을 비교 |
| `--trace` | 루트 서버부터 위임을 따라가며 표시 |
| `-W, --timeout <ms>` | 각 질의를 기다리는 시간 (기본값: 3000) |

질의는 시스템 DNS 서버로 UDP로 보내고, 응답이 UDP 한 패킷에 담기지 않을 만큼 크면 자동으로 TCP로 다시 묻습니다. 시스템에 쓸 수 있는 DNS 서버가 없으면(Windows에서 일부 VPN을 쓰면 `127.0.0.1`만 설정되는 경우가 있습니다) HTTPS로 공개 DNS-over-HTTPS 서버에 묻습니다. 레코드를 찾지 못하면 종료 코드는 1입니다.

`--compare`는 시스템 서버와 [Cloudflare](https://1.1.1.1), [Google](https://developers.google.com/speed/public-dns), [Quad9](https://www.quad9.net)에 같은 질문을 하고 답을 나란히 보여줍니다. 도메인을 바꾼 뒤 변경이 퍼졌는지 확인할 때 가장 빠릅니다. 답하지 않은 서버는 따로 알려 주고 비교에서는 빼며, 답한 서버들의 내용이 서로 다르면 종료 코드는 1입니다.

`--trace`는 `dig +trace`처럼 루트 서버에서 시작해 권한 서버까지 위임을 따라가며 각 단계의 네임서버와 응답 시간을 보여줍니다. 루트·권한 서버에 UDP 53으로 직접 물어보므로, 그 포트가 막힌 네트워크에서는 동작하지 않습니다.

### whois

도메인, IP 대역, AS 번호를 누가 언제 등록했는지 조회합니다. 등록 기관의 RDAP 서버에 먼저 묻고, 아직 RDAP을 제공하지 않는 국가 도메인은 기존 WHOIS(43번 포트)로 조회합니다.

```console
$ unt whois google.com                   # 등록 기관, 날짜, 상태, 네임서버
$ unt whois https://www.naver.co.kr/     # URL과 서브도메인도 가능
$ unt whois 8.8.8.8                      # 네트워크 소유 기관과 신고 연락처
$ unt whois AS15169                      # AS 번호 소유 기관
$ unt whois example.com --raw            # 서버가 보낸 원본 응답
```

| 옵션 | 설명 |
| --- | --- |
| `-W, --timeout <ms>` | 서버마다 응답을 기다리는 시간 (기본값: 10000) |
| `--raw` | 서버가 보낸 원본 응답 출력 |

### ip

IP 주소가 어느 네트워크에 속하는지 보여줍니다. 호스트 이름(역방향 DNS), 그 주소를 광고하는 AS 번호와 BGP 대역([Team Cymru](https://www.team-cymru.com/ip-asn-mapping)), 등록된 소유 기관과 신고 연락처(RDAP)가 나옵니다. 도메인을 넣으면 그 도메인의 모든 IPv4·IPv6 주소를 표로 보여줍니다. 위치는 조회하지 않습니다.

```console
$ unt ip 8.8.8.8          # 주소 하나의 자세한 정보
$ unt ip google.com       # 도메인의 모든 주소
$ unt ip google.com -6    # IPv6 주소만
```

| 옵션 | 설명 |
| --- | --- |
| `-W, --timeout <ms>` | 조회마다 응답을 기다리는 시간 (기본값: 10000) |
| `-4, --ipv4` / `-6, --ipv6` | 도메인의 IPv4 또는 IPv6 주소만 사용 |

사설·예약 주소는 외부 서비스로 보내지 않습니다. 조회 중 일부가 실패해도 나머지 정보는 경고와 함께 보여주고, 종료 코드는 1입니다.

호스트 이름과 AS 번호는 시스템 DNS 서버에 묻습니다. 시스템 DNS 서버에 직접 닿지 못하면(Windows에서 일부 VPN을 쓸 때 생깁니다) HTTPS로 공개 DNS-over-HTTPS 서버(dns.google, 안 되면 cloudflare-dns.com)에 대신 묻고, 사설 주소의 호스트 이름은 생략합니다.

### geoip

IP 주소의 대략적인 위치를 보여줍니다. 국가, 지역, 도시, 좌표와 OpenStreetMap 링크, 시간대, 네트워크, 알려진 프록시·VPN인지가 나옵니다. 도메인을 넣으면 그 도메인의 모든 주소를 표로 보여줍니다.

```console
$ unt geoip 8.8.8.8
$ unt geoip google.com
```

| 옵션 | 설명 |
| --- | --- |
| `-W, --timeout <ms>` | 조회마다 응답을 기다리는 시간 (기본값: 10000) |
| `-4, --ipv4` / `-6, --ipv6` | 도메인의 IPv4 또는 IPv6 주소만 사용 |

위치는 [FreeIPAPI](https://freeipapi.com)에서 가져오고, 실패하면 [GeoJS](https://www.geojs.io)로 대신합니다. 둘 다 무료이고 API 키가 필요 없으며 상업적 이용도 허용합니다. 위치를 조회하려면 `geoip`가 주소를 이 서비스들로 보냅니다. 사설·예약 주소는 보내지 않습니다. 위치는 추정값이라 서비스마다 다를 수 있습니다.

### info

도메인이나 IP 주소의 정보를 한 번에 보여줍니다. 도메인은 등록 정보(등록 기관, 날짜, 네임서버)를 요약하고, 모든 주소를 호스트 이름, AS 번호, 소유 기관, 위치와 함께 표로 보여줍니다. IP 주소는 `ip`와 `geoip`의 내용을 합쳐서 보여줍니다.

```console
$ unt info google.com
$ unt info 8.8.8.8
$ unt info google.com --no-geo   # 주소를 위치 서비스로 보내지 않음
```

| 옵션 | 설명 |
| --- | --- |
| `-W, --timeout <ms>` | 조회마다 응답을 기다리는 시간 (기본값: 10000) |
| `--no-geo` | 위치 조회 생략 |
| `-4, --ipv4` / `-6, --ipv6` | 도메인의 IPv4 또는 IPv6 주소만 사용 |

조회 중 일부가 실패해도 나머지 정보는 경고와 함께 보여주고, 종료 코드는 1입니다.

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
