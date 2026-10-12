# 기여 가이드

Uranus-NetTools에 관심을 가져주셔서 감사합니다. 이 문서는 이슈 생성부터 PR 머지까지의 작업 규칙을 설명합니다. 커밋 메시지는 [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md)의 규칙을 따릅니다.

## 개발 환경

Node.js 22.13 이상과 npm이 필요합니다. 저장소를 받은 뒤 `npm install`로 의존성을 설치하면, 커밋 메시지를 검사하는 git 훅도 함께 설치됩니다.

| 명령 | 설명 |
| --- | --- |
| `npm run dev -- <인자>` | 빌드 없이 소스를 바로 실행합니다. 예: `npm run dev -- --help` |
| `npm run build` | `dist/unt.cjs` 하나로 번들링합니다. |
| `npm run typecheck` | TypeScript 타입을 검사합니다. |
| `npm run lint` | ESLint로 코드를 검사합니다. |
| `npm run format` | Prettier로 코드를 정리합니다. |
| `npm test` | Vitest로 테스트를 실행합니다. |
| `npm run check` | 타입 검사, 린트, 포맷 검사, 테스트를 한 번에 실행합니다. |

PR을 올리기 전에 `npm run check`가 통과하는지 확인해 주세요.

## 개발 프로세스

1. 이슈를 생성합니다.
2. 이슈를 기반으로 브랜치를 생성합니다.
3. 이슈와 관련된 기능 개발을 완료합니다.
4. PR을 생성합니다. PR 제목과 merge commit 메시지도 [커밋 규칙](COMMIT_CONVENTION.md)에 맞춰 작성합니다.
5. 아래 조건을 만족하면 주요 브랜치로 머지합니다.
   - 최소 1명의 리뷰 승인(Approve)
   - CI 빌드 성공
   - 테스트 케이스 작성 (선택)
6. 머지 후 feature 브랜치를 삭제합니다.
7. 이슈를 닫습니다.

## 이슈 규칙

- 한 기능당 하나의 이슈 생성을 원칙으로 합니다.
- 이슈 성격에 맞는 라벨을 선택해 추가합니다.

### 라벨

새 리포지토리를 생성하면 이슈 라벨을 아래와 같이 설정합니다.

| Label | Description | Color | 의미 |
| --- | --- | --- | --- |
| `BUG` | Something isn't working | `#d73a4a` | 예기치 않은 문제 또는 의도하지 않은 동작(버그) |
| `feature` | New feature or request | `#a701d2` | 새로운 기능 요청 |
| `DOCS` | Improvements or additions to documentation | `#cfd3d7` | 문서 개선 또는 추가 |
| `Chore` | | `#0075ca` | 자잘한 수정 |
| `Refactor` | Refactoring is needed | `#008672` | 리팩토링 필요 |
| `프로젝트 설정` | Project setting is needed | `#555303` | 프로젝트 설정 필요 |
| `테스트 추가` | Request a new test | `#CD7F57` | 새로운 테스트 요청 |

## 브랜치 규칙

기본적으로 [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/)를 따릅니다.

| 브랜치 | 역할 |
| --- | --- |
| `main` | 릴리즈된 버전만 올라가는 브랜치 |
| `develop` | 다음 버전을 개발하는 기본 브랜치. feature 브랜치는 여기서 분기해 여기로 머지 |
| `feature/{이슈 번호}_{할 일}` | 기능 개발 브랜치 |
| `hotfix/{이슈 번호}_{할 일}` | 릴리즈된 버전의 긴급 수정 브랜치. `main`에서 분기 |

`{할 일}`은 영어 kebab-case로 짧게 씁니다.

```
feature/12_tcp-ping
hotfix/31_scan-timeout
```

## Pull Request 규칙

- 제목은 `🔀 :: (#이슈 번호) Subject` 형식으로 씁니다. 예: `🔀 :: (#12) TCP ping 기능 추가`
- 본문에 `Closes #이슈 번호`를 적어 머지할 때 이슈가 자동으로 닫히게 합니다. 자동 종료는 기본 브랜치(`develop`)로 머지될 때만 동작하므로, hotfix는 머지 후 이슈를 직접 닫습니다.
- feature 브랜치는 `develop`으로 PR을 보냅니다. hotfix 브랜치는 `main`으로 PR을 보내고, 같은 수정을 `develop`에도 반영합니다.
- merge commit 방식으로 머지하고, merge commit 메시지도 PR 제목과 같은 형식으로 씁니다.

## 템플릿

이슈와 PR은 저장소에 준비된 템플릿으로 작성합니다.

| 템플릿 | 용도 | 자동 라벨 |
| --- | --- | --- |
| `⚡️ 기능` | 새 기능 제안과 개발 | `feature` |
| `🐛 버그` | 버그 제보 | `BUG` |
| `🛠️ 작업` | 문서, 프로젝트 설정, 리팩토링, 테스트 등 | 직접 선택 |
| PR 템플릿 | 모든 PR | - |

이슈 제목도 커밋 타입 형식을 따릅니다. 예: `⚡️ :: TCP ping 기능 구현`

## 버전 규칙

`Major.Minor.Patch` 형식을 쓰며, 모든 버전은 `01.00.00`에서 시작합니다. 표기할 때는 앞자리 0을 생략합니다.

```
01.01.09 → 1.1.9
01.01.10 → 1.1.10
```

| 자리 | 시작 값 | 올리는 경우 |
| --- | --- | --- |
| Major | `1` | 전체를 뒤엎는 변화가 있을 때. 올리면 나머지 버전은 초기화 |
| Minor | `00` | 없던 기능이 추가되거나 기존 기능이 수정될 때 |
| Patch | `00` | 자잘한 버그 수정이나 내부 코드 보완이 있을 때 |

## 릴리즈

1. `develop`을 `main`으로 머지합니다.
2. `main`에 `vX.Y.Z` 태그를 붙입니다.
3. GitHub Release를 `🚀 :: vX.Y.Z` 제목으로 발행합니다.
