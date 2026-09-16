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
