# 송정 AI 페스티벌

서울송정초등학교 3~6학년 AI 미션 투어 운영 웹앱입니다. 제품 요구사항은 [AI_FESTIVAL_SPEC.md](AI_FESTIVAL_SPEC.md), 작업 규칙은 [CLAUDE.md](CLAUDE.md)에 있습니다.

현재 단계는 **5단계 실시간 대시보드, 네 조각 카드 성장, 학급 전체 최종 미션**입니다. 규칙은 [CARD_FINALE_UPDATE_SPEC.md](CARD_FINALE_UPDATE_SPEC.md) 버전 3.0을 따릅니다.

| 기능 | mock 모드 | Firebase 모드 |
| --- | --- | --- |
| 팀 입장, 미션 5종, 채점·순위 확정 | 동작 | 동작 |
| 순위별 카드 보상 선택, 네 조각 카드 성장 | 동작 | 동작 |
| 교실 QR 체크인, 실시간 운영 대시보드, 부스 “미션 시작” | 동작 | 동작 |
| 학급 전체 최종 미션(10문제·공통 힌트), 최종 순위 | 동작 | 동작 |

mock 데이터는 브라우저 메모리에만 있어 새로고침하면 처음 상태로 돌아갑니다. 모든 기능은 무료 Spark 요금제 안에서 동작하도록 만들며 Cloud Functions, Cloud Storage, 외부 AI API를 쓰지 않습니다.

> **보안 규칙을 꼭 다시 배포하세요.** QR 체크인·대시보드·최종 미션은 새 컬렉션과 역할별 권한을 쓰므로, 코드를 올리기 전에 `firebase deploy --only firestore:rules,firestore:indexes`로 규칙을 먼저 배포해야 합니다. 규칙이 예전 것이면 새 기능에서 "권한이 없어요"가 나옵니다.

## 개발 서버

```bash
npm install
npm run dev
```

주소는 http://localhost:5173 입니다. `127.0.0.1`이 아니라 `localhost`로 열어 주세요.

## 검사

```bash
npm run lint          # ESLint
npm run test -- --run # Vitest
npm run build         # 타입 검사 + production 빌드
npm run format        # Prettier 정리
```

## 미리보기 주소

`main`(또는 `master`)에 push하면 GitHub Actions가 검사와 빌드를 하고 GitHub Pages에 배포합니다. 배포 주소는 저장소의 Actions 탭과 Settings → Pages에서 확인할 수 있습니다.

## Firebase 연결 (2단계)

보안 규칙과 Firestore 저장소 구현은 끝났습니다. 실제 프로젝트에 연결하는 순서는 다음과 같습니다.

1. Firebase 콘솔에서 프로젝트를 만듭니다. 결제 정보는 등록하지 않습니다(무료 Spark 요금제).
2. Firestore(위치 asia-northeast3)와 Authentication(익명, Google)을 사용 설정합니다.
3. 웹 앱을 추가해 설정값을 받아 `.env` 파일에 채웁니다. `.env.example`을 복사해 쓰면 됩니다.
4. `VITE_DATA_MODE=firebase`로 두고 `npm run dev`를 실행합니다.
5. 교사용 로그인에서 학교 Google 계정으로 로그인하면 "등록된 교사 계정이 아니에요"가 나옵니다. 콘솔 Authentication에서 그 계정의 UID를 복사해 Firestore에 `teachers/{UID}` 문서를 만들고 `displayName`, `email`, `role`, `active: true`를 넣습니다. `role`은 `admin`(총괄), `station_teacher`(부스, `missionId`로 담당 미션 지정), `homeroom_teacher`(담임, `classId`로 담당 학급 지정) 중 하나입니다. 예전 값 `teacher`는 담당 미션이 없는 부스 교사로 취급합니다. 라운드 시작·종료와 학년 변경은 `admin`만 할 수 있습니다.
6. 다시 로그인한 뒤 교사 화면의 **행사 설정**에서 "행사 구조 만들기"를 누르면 학급 20개, 팀 100개, 미션 5개가 생성됩니다.
7. 보안 규칙과 색인을 배포합니다.

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### 로컬 에뮬레이터

실제 프로젝트 없이 개발하려면 에뮬레이터를 씁니다. Java 21 이상이 필요합니다.

```bash
npm run emulators
```

`.env`에 `VITE_USE_FIREBASE_EMULATORS=1`과 `VITE_DATA_MODE=firebase`를 두면 앱이 에뮬레이터에 연결됩니다.

### 보안 규칙 테스트

```bash
npm run test:emulator
```

에뮬레이터를 자동으로 띄워 보안 규칙(역할별 권한, QR 체크인, 최종 미션)과 Firestore 저장소 동작을 실제 역할(총괄·부스·담임·학생)로 확인합니다.

### Firebase 모드의 역할과 권한

| 역할(`teachers/{UID}.role`) | 할 수 있는 일 |
| --- | --- |
| `admin` 총괄 | 행사 구조 만들기, 학년·라운드 제어, 모든 부스 운영, 최종 미션 열기·제한 시간·결과 공개·강제 마감·보정·초기화 |
| `station_teacher` 부스 | `missionId`로 지정한 미션의 미션 시작, 직접 입장 처리, 채점·결과 확정, 문제 설정. `missionId`가 비어 있으면 모든 부스 |
| `homeroom_teacher` 담임 | `classId`(예: `g4-c2`)로 지정한 학급의 최종 미션 시작과 풀이. 대시보드는 읽기 전용 |

권한은 앱 화면뿐 아니라 Firestore 보안 규칙에서도 검사합니다. 학생(익명 로그인)은 자기 팀의 제출, 카드 선택, 교실 QR 체크인만 기록할 수 있고 최종 미션 문서는 읽을 수 없습니다.

### 최종 미션 문제 넣기

"행사 구조 만들기"를 누르면(또는 총괄이 학년의 최종 미션을 열 때) 문제가 없는 학년에 샘플 10문제가 들어갑니다. 실제 문제는 행사 전에 Firebase 콘솔에서 두 문서를 고쳐 넣습니다. 문제 편집 화면은 아직 없습니다.

- `events/{eventId}/finalQuestionSets/{학년}`: `questions` 배열(10개). 각 항목은 `id`, `area`(thinking·observation·expression·command·verification), `text`, `passage`(없으면 null), `choices`(`{id, label}` 4개), `hintRemoveChoiceId`(힌트로 지울 오답 보기 ID)
- `events/{eventId}/finalAnswerKeys/{학년}`: `answers` 맵(`문제 id → 정답 보기 id`). 이 문서는 총괄 계정만 읽을 수 있어 담임 선생님 기기에는 정답이 내려가지 않습니다. 채점은 총괄 화면에서 하고, 결과를 공개할 때 학급 상태에 기록됩니다.

### 무료 사용량(읽기)을 아끼는 방식

- 대시보드와 부스 화면은 학년의 작은 상태 문서(팀 체크인, 부스, 라운드)를 실시간 구독해 메모리에 들고 있고, 화면을 다시 그릴 때 문서를 다시 읽지 않습니다. 읽기는 "바뀐 문서 수 × 보고 있는 교사 수"만큼만 듭니다.
- 팀의 "진행 중·완료"는 따로 저장하지 않고 부스 문서(미션 시작 시각, 결과를 확정한 팀)로 계산합니다. 부스가 미션을 시작해도 팀 문서 5개를 다시 쓰지 않습니다.
- 최근 활동은 별도 컬렉션에 쓰지 않고 구독 중인 문서의 시각으로 만듭니다.
- 학급 화면과 전자칠판 화면은 자기 학급 문서만 구독해 다른 반이 문제를 풀어도 다시 읽지 않습니다. 학급 응답은 문서 하나(`finalResponses/{classId}`)에 모읍니다.
- 타이머는 Firestore에 쓰지 않습니다. 기기 시계와 서버 시계의 차이는 접속할 때 한 번(쓰기 1·읽기 1) 재서 보정합니다.

## 화면 둘러보기

mock 모드(`VITE_DATA_MODE=mock`) 기준입니다.

- 학생: 시작 화면 → 팀 입장 → 팀 홈 → 교실 QR 체크인(`/check-in/:eventId/:stationId`) → 미션 → 카드 보상 선택(`/team/:eventId/:teamId/reward`) → 학급 카드 현황(`/cards`)
- 교사 로그인: `/teacher/login`에서 "총괄 선생님으로 입장". "다른 역할로 미리 보기"에서 부스·담임 선생님 화면도 확인할 수 있습니다.
- 총괄: 대시보드(`/teacher/:eventId/dashboard`)에서 라운드 제어, 부스 5곳, 학급·팀 표, 확인 필요(미도착·잘못된 교실·결과 미입력), 최근 활동 확인 → 최종 미션(`/teacher/:eventId/final-results`)에서 학년 개방, 반별 진행 중계, 결과 공개, 보정
- 부스: `/teacher/:eventId/station/:stationId`에서 입장 현황, "미션 시작", 직접 입장 처리, 결과 확정(카드 보상 생성), 교실 QR 주소 복사
- 담임: `/teacher/:eventId/class/:classId`에서 팀 위치·카드·힌트 수 확인 → "최종 미션 시작"(확인 → 3, 2, 1 카운트다운) → 전자칠판 화면(`/class/:classId/final`)에서 10문제 풀이
- 샘플 팀은 4학년 2반 3팀이며, 2라운드 진행 중(시작 2분 30초 뒤)이고 1라운드 1위 카드 보상을 아직 고르지 않았습니다. 이 팀과 4반 5팀은 미도착, 5반 4팀은 다른 교실 QR을 찍은 상태입니다.
- 3학년은 투어를 마치고 최종 미션이 열려 있습니다. 1반(5종 완성·힌트 5개, 4번 문제 풀이 중), 2·3반(제출 완료, 결과 공개 전), 4반(시작 전, 검증 카드 0/4)에서 각 상태를 볼 수 있습니다.
- 예전 `/draw`, `/finale`, 팀별 `/final`, `/class/:eventId/:classId/final`, `/teacher/:eventId/mission/:missionId`, `/teacher/:eventId/final`, `/teacher/:eventId/exchange` 주소는 새 화면으로 이동합니다.

### 교실 QR 만들기

부스 화면 아래 "교실 QR 주소"를 복사해 QR 코드로 만들어 교실 입구에 붙입니다. 팀 기기로 찍으면 그 기기에 입장한 팀의 도착이 기록됩니다. 같은 QR을 여러 번 찍어도 기록은 하나입니다.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `VITE_DATA_MODE` | `mock`(기본) 또는 `firebase` |
| `VITE_BASE` | 빌드 경로. GitHub Pages 배포에서만 `/저장소이름/`으로 설정됩니다. |

## 폴더 구조

```
src/
  app/          라우팅, 공급자, 경로 상수
  components/   공통 UI(헤더, MissionShell, 타이머, 버튼, 상태 화면)
  data/         EventRepository 인터페이스, mock·Firestore 구현, 최종 미션 샘플 문제
  domain/       미션 순환, 팀 이동·경고, 순위별 카드 보상, 네 조각 카드 성장, 최종 미션 규칙과 타입
  features/     화면별 폴더(start, join, tour, missions, cards, final, teacher)
  hooks/        데이터 로딩·동작 실행 훅
  styles/       디자인 토큰과 전역 스타일
public/assets/  행사 이미지와 학교 로고
```
