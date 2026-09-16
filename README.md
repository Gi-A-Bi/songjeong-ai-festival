# 송정 AI 페스티벌

서울송정초등학교 3~6학년 AI 미션 투어 운영 웹앱입니다. 제품 요구사항은 [AI_FESTIVAL_SPEC.md](AI_FESTIVAL_SPEC.md), 작업 규칙은 [CLAUDE.md](CLAUDE.md)에 있습니다.

현재 단계는 **1단계 로컬 목업**입니다. Firebase는 아직 연결하지 않았고, 모든 데이터는 브라우저 메모리의 샘플 데이터(mock)입니다. 새로고침하면 처음 상태로 돌아갑니다.

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
5. 교사용 로그인에서 학교 Google 계정으로 로그인하면 "등록된 교사 계정이 아니에요"가 나옵니다. 콘솔 Authentication에서 그 계정의 UID를 복사해 Firestore에 `teachers/{UID}` 문서를 만들고 `displayName`, `email`, `role`(teacher 또는 admin), `active: true`를 넣습니다.
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
npm run test:rules
```

에뮬레이터를 자동으로 띄워 학생·교사 권한 규칙 18가지를 확인합니다.

## 화면 둘러보기

- 학생: 시작 화면 → 팀 입장 → 팀 홈 → 미션 → 카드 뽑기 → 카드함
- 교사: `/teacher/login`에서 "개발용 교사로 입장" → 대시보드 → 미션 운영 → 카드 교환
- 샘플 팀은 4학년 2반 3팀이며, 2라운드 진행 중 상태로 시작합니다.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `VITE_DATA_MODE` | `mock`(기본) 또는 `firebase`(2단계 예정) |
| `VITE_BASE` | 빌드 경로. GitHub Pages 배포에서만 `/저장소이름/`으로 설정됩니다. |

## 폴더 구조

```
src/
  app/          라우팅, 공급자, 경로 상수
  components/   공통 UI(헤더, MissionShell, 타이머, 버튼, 상태 화면)
  data/         EventRepository 인터페이스와 mock 구현
  domain/       미션 순환, 뽑기권, 카드, 교환 규칙과 타입
  features/     화면별 폴더(start, join, tour, missions, cards, teacher, exchange)
  hooks/        데이터 로딩·동작 실행 훅
  styles/       디자인 토큰과 전역 스타일
public/assets/  행사 이미지와 학교 로고
```
