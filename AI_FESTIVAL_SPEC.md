# 송정 AI 페스티벌 웹 프로그램 개발 명세서

문서 버전: 1.0  
작성 기준일: 2026-09-15  
대상 학교: 서울송정초등학교  
행사 형태: 3~6학년 주간 하루형 AI 미션 투어

## 1. 제품 한눈에 보기

송정 AI 페스티벌 웹 프로그램은 학생들이 5개의 AI 미션 교실을 순환하고, 미션 결과에 따라 카드를 뽑고, 학급별 카드 교환을 통해 5종의 AI 능력 카드를 완성하는 행사 운영 도구다.

핵심 경험은 다음과 같다.

1. 학생은 팀 QR을 찍고 자기 팀 화면에 들어간다.
2. 5개 팀이 서로 다른 미션에서 출발해 10분마다 다음 미션으로 이동한다.
3. 미션별 결과와 순위에 따라 카드 뽑기 기회를 받는다.
4. 카드를 웹에서 뽑으면 팀과 학급 카드함에 자동 기록된다.
5. 투어가 끝난 뒤 학급끼리 카드를 교환하여 5종 카드 완성을 노린다.
6. 교사는 진행 상황, 제출물, 순위, 카드 현황을 한 화면에서 관리한다.

행사의 분위기는 귀엽고 역동적인 “AI 스포츠 페스티벌”이다. 억지스러운 위기 서사보다 실제 종목에 도전하고 능력 카드를 모으는 즐거움에 집중한다.

## 2. 확정된 운영 조건

| 구분 | 내용 |
| --- | --- |
| 참여 학년 | 3~6학년 |
| 학급 수 | 3학년 4개 반, 4학년 5개 반, 5학년 6개 반, 6학년 5개 반 |
| 전체 학급 | 20개 학급 |
| 팀 편성 | 학급당 5팀 |
| 전체 팀 | 100팀 |
| 동시 운영 | 한 번에 한 학년, 약 100명 |
| 기기 기준 | 팀당 디벗 1대 |
| 미션 수 | 5개 |
| 투어 시간 | 60분 |
| 한 라운드 | 활동 8분 + 이동 2분 |
| 라운드 수 | 5라운드 |
| 카드 교환 | 미션 투어 이후 학급별 10~15분 |

학년별 동시 접속 팀 수는 20~30팀이다. 교사용 화면과 예비 기기를 포함해 동시 접속 50클라이언트를 안정성 목표로 잡는다.

## 3. 미션 순환 규칙

각 학급은 1팀부터 5팀까지 편성한다. 팀 번호가 시작 미션 번호가 된다.

| 팀 번호 | 1라운드 시작 |
| --- | --- |
| 1팀 | AI 골든벨 |
| 2팀 | AI 틀린그림 찾기 |
| 3팀 | AI 설명대로 그려라 |
| 4팀 | 로봇 길찾기 |
| 5팀 | AI 오류찾기 |

다음 라운드에는 다음 번호 미션으로 이동하며, 5번 다음은 1번으로 돌아간다. 계산 규칙은 다음과 같다.

    현재 미션 번호 = ((팀 번호 - 1 + 라운드 번호 - 1) mod 5) + 1

따라서 한 미션 교실에는 매 라운드마다 같은 학년의 각 학급에서 한 팀씩 모인다.

- 3학년: 미션 교실당 4팀
- 4학년: 미션 교실당 5팀
- 5학년: 미션 교실당 6팀
- 6학년: 미션 교실당 5팀

## 4. 60분 시간표

| 시간 | 학생 활동 | 프로그램 역할 |
| --- | --- | --- |
| 0~5분 | 교실 영상 시청, QR 입장, 팀 확인 | 행사 소개, 팀 인증, 첫 미션 안내 |
| 5~13분 | 1라운드 | 문제·타이머·제출·교사 판정 |
| 13~15분 | 이동 | 다음 교실과 남은 시간 안내 |
| 15~23분 | 2라운드 | 동일 |
| 23~25분 | 이동 | 동일 |
| 25~33분 | 3라운드 | 동일 |
| 33~35분 | 이동 | 동일 |
| 35~43분 | 4라운드 | 동일 |
| 43~45분 | 이동 | 동일 |
| 45~53분 | 5라운드 | 동일 |
| 53~55분 | 이동·정리 | 카드함으로 전환 |
| 55~60분 | 카드 확인·결과 안내 | 획득 카드와 학급 현황 표시 |

카드 교환은 60분 투어와 분리하여 각 학급에서 10~15분간 진행한다.

## 5. 사용자 역할

### 5.1 학생 팀

- QR 링크로 팀 화면 입장
- 학년, 반, 팀 번호 확인
- 현재 미션과 다음 이동 장소 확인
- 웹 미션 수행 및 결과 제출
- 부여된 카드 뽑기 기회 사용
- 팀 카드함과 학급 카드 현황 확인

학생 개인 계정과 이름은 수집하지 않는다.

### 5.2 미션 담당 교사

- Google 계정으로 로그인
- 담당 미션의 현재 라운드 시작·일시정지·종료
- 제출 현황 확인
- 수동 채점 또는 순위 확정
- 순위에 따른 카드 뽑기권 지급
- 오류 제출 취소와 재제출 허용

### 5.3 총괄 관리자

- 행사, 학년, 학급, 팀 생성
- 미션 문제와 정답 설정
- 라운드 상태 일괄 제어
- 전체 현황 및 장애 확인
- 카드 교환 처리
- 결과를 CSV 또는 JSON으로 내보내기
- 리허설 데이터 초기화

초기 버전에서는 교사와 관리자를 하나의 교사용 앱 안에서 역할값으로 구분한다.

## 6. 다섯 가지 미션

### 6.1 AI 골든벨

목표: AI와 디지털 생활에 관한 문제를 팀이 함께 풀며 판단력을 기른다.

학생 화면:

- 문제 번호, 질문, 보기 또는 단답 입력
- 8분 전체 타이머
- 답 제출 후 수정 가능 여부 표시
- 제출 완료 상태
- 교사가 공개한 경우에만 정답과 해설 표시

교사 화면:

- 문제 열기
- 답변 접수 시작·종료
- 정답 공개
- 팀별 점수와 제출 시간 확인
- 동점일 경우 교사가 순위 조정
- 최종 순위 확정

권장 기본 규칙:

- 객관식 7문항
- 정답 100점, 오답 0점
- 총점 우선, 동점이면 마지막 정답 제출 시각이 빠른 팀 우선
- 교사는 언제든 순위를 수동 수정할 수 있음

### 6.2 AI 틀린그림 찾기

목표: AI가 만든 이미지 속 부자연스럽거나 논리적으로 맞지 않는 부분을 관찰한다.

학생 화면:

- 확대 가능한 한 장의 이미지
- 의심되는 위치를 터치하여 표시
- 찾은 개수, 오답 횟수, 남은 시간
- 힌트는 교사가 활성화했을 때만 사용

콘텐츠 설정:

- 정답 영역은 이미지 크기에 무관하도록 0~1 사이의 정규화 좌표로 저장
- 원 또는 다각형 영역 지원은 최종 목표이며, MVP는 원형 영역만 구현
- 같은 정답 영역 반복 터치는 중복 처리하지 않음

점수 기본값:

    기본점수 = 찾은 정답 수 × 100
    시간보너스 = 남은 초 × 2
    오답감점 = 오답 수 × 20
    최종점수 = max(0, 기본점수 + 시간보너스 - 오답감점)

교사는 자동 계산 점수를 확인한 뒤 순위를 확정한다.

### 6.3 AI 설명대로 그려라

목표: 같은 설명을 듣고 핵심 조건을 시각적으로 표현한다.

학생 화면:

- 모든 팀에 동일한 그림 설명
- 펜, 지우개, 색상, 굵기, 전체 지우기, 실행 취소
- 제출 전 미리보기와 확인
- 한 번 제출 후 교사가 재제출을 허용할 때만 수정 가능

채점 방법:

- 프로그램 안에 생성형 AI 채점 API를 넣지 않는다.
- 교사는 제출 이미지를 한꺼번에 내려받는다.
- 교사가 별도의 생성형 AI 서비스에 공통 설명과 제출 이미지들을 첨부한다.
- “설명 조건과 가장 가까운 순서”로 평가하도록 요청한다.
- AI 평가 결과는 참고자료로 사용하고, 최종 순위는 교사가 입력한다.

그림 저장:

- Firebase Cloud Storage는 사용하지 않는다.
- 브라우저에서 최대 960×540 크기의 WebP로 압축한다.
- 목표 품질은 0.65, 최대 크기는 300KB다.
- 압축된 바이트를 Firestore의 별도 제출 문서에 임시 저장한다.
- 교사용 화면은 제출 목록에서 요청할 때만 이미지 데이터를 읽는다.
- 행사 종료 후 관리자가 그림 제출 데이터만 일괄 삭제한다.

주의: Firestore 문서 최대 크기는 1MiB이므로 300KB 제한을 코드와 보안 규칙 양쪽에서 검증한다. 실제로는 메타데이터 여유를 남기기 위해 350KB 이상이면 제출을 차단한다.

### 6.4 로봇 길찾기

목표: 오조봇이 길을 빠르고 정확하게 통과하도록 길과 컬러 코드를 설계한다.

학생 화면:

- 미션 규칙과 코스 이미지
- 시작 준비 버튼
- 남은 시간
- “교사 확인 대기” 상태

교사 화면:

- 팀별 완주 여부
- 완주 시간 입력
- 감점 또는 재시도 횟수 입력
- 순위 자동 정렬 후 수동 조정

로봇 기록은 교사가 직접 확인한다. 센서 연동이나 카메라 자동 판독은 범위에서 제외한다.

### 6.5 AI 오류찾기

목표: “AI가 찾은 정보”에서 잘못된 부분을 발견하고 도서관 책으로 사실을 확인한다.

학생 화면:

- AI가 작성한 짧은 정보 글
- 잘못된 문장 또는 부분 입력
- 책에서 확인한 올바른 내용 입력
- 책 제목 입력
- 쪽수 입력
- 제출

교사 화면:

- 팀별 답과 출처를 나란히 확인
- 정답 요소별 체크
- 점수·완료 시간 확인
- 순위 확정

기본 채점:

- 오류 지점 정확성 40점
- 수정 내용 정확성 40점
- 책 제목과 쪽수의 구체성 20점
- 총점 동점이면 제출 시각이 빠른 팀 우선

핵심은 인터넷 검색이 아니라 도서관 책을 근거로 검증하는 것이다.

## 7. 순위와 카드 보상

| 미션 순위 | 카드 뽑기권 |
| --- | --- |
| 1위 | 3장 |
| 2위 | 2장 |
| 3위 이하 | 1장 |

참가 팀이 4~6팀이어도 같은 규칙을 사용한다.

카드 종류는 5개이며 기본 확률은 모두 20퍼센트다.

| 카드 | 연결 미션 | 의미 |
| --- | --- | --- |
| 생각 카드 | AI 골든벨 | 질문하고 판단하는 힘 |
| 관찰 카드 | 틀린그림 찾기 | 자세히 보고 차이를 찾는 힘 |
| 표현 카드 | 설명대로 그려라 | 생각을 그림으로 나타내는 힘 |
| 명령 카드 | 로봇 길찾기 | 순서와 규칙으로 움직이게 하는 힘 |
| 검증 카드 | AI 오류찾기 | 근거를 찾아 사실을 확인하는 힘 |

카드 규칙:

- 중복 획득 가능
- 카드 뽑기권은 교사가 순위를 확정할 때 생성
- 카드 종류는 뽑기권 생성 시 무작위로 미리 정해짐
- 학생이 카드를 누르면 뒤집기 애니메이션 후 공개
- 한 뽑기권은 한 번만 사용할 수 있음
- 카드 획득 기록은 삭제하지 않는 이벤트 원장으로 보관
- 팀 카드함과 학급 카드함은 원장을 기준으로 계산

카드가 클라이언트에서 임의로 늘어나지 않도록, 수량 맵 자체보다 변경 기록을 원본 데이터로 취급한다.

## 8. 카드 교환

교환 단위는 학급이다. 기본안은 같은 학년의 학급끼리 교환하는 방식이다.

교사용 교환 화면:

1. 각 학급의 5종 카드 수량을 표로 표시
2. 보내는 학급과 받는 학급 선택
3. 카드 종류와 수량 선택
4. 교환 전후 예상 수량 표시
5. 양쪽 교사가 확인하거나 총괄 교사가 확정
6. 교환 원장 기록

교환 안전 규칙:

- 보유 수량보다 많이 보낼 수 없음
- 0장 또는 음수 교환 불가
- 교환 확정은 Firestore 트랜잭션으로 처리
- 중복 클릭 방지를 위한 고유 요청 ID 사용
- 잘못된 교환은 삭제하지 않고 반대 방향의 정정 기록으로 취소

완성 조건:

- 학급이 5종 카드를 각각 1장 이상 보유하면 “AI 능력 컬렉션 완성”
- 완성 학급 화면에 피날레 이미지와 축하 효과 표시
- 카드 개수 경쟁보다 완성을 우선하고, 전체 수량 순위는 선택 기능으로 둠

## 9. 화면 구조

### 9.1 공통

- 홈
- 연결 상태 배지
- 전체 화면 버튼
- 소리 켜기·끄기
- 뒤로 가기
- 오류 안내와 재시도

### 9.2 학생 화면

| 경로 | 화면 |
| --- | --- |
| / | 행사 시작 화면 |
| /join/:eventId | 팀 확인·입장 |
| /team/:eventId/:teamId | 팀 홈과 현재 미션 |
| /team/:eventId/:teamId/mission/:missionId | 미션 수행 |
| /team/:eventId/:teamId/draw | 카드 뽑기 |
| /team/:eventId/:teamId/cards | 팀·학급 카드함 |
| /team/:eventId/:teamId/finale | 완성 축하 |

### 9.3 교사 화면

| 경로 | 화면 |
| --- | --- |
| /teacher/login | Google 로그인 |
| /teacher/:eventId | 전체 운영 대시보드 |
| /teacher/:eventId/mission/:missionId | 미션 진행·채점 |
| /teacher/:eventId/class/:classId | 학급 카드함 |
| /teacher/:eventId/exchange | 카드 교환 |
| /teacher/:eventId/export | 결과 내보내기 |
| /admin/:eventId | 행사 설정·초기화 |

## 10. 디자인 원칙

### 10.1 전체 분위기

- 귀엽고 활기찬 AI 스포츠 페스티벌
- 학생이 지금 해야 할 행동을 3초 안에 이해
- 한 화면에 핵심 행동 하나
- 긴 문단 대신 짧은 문장과 시각 요소
- 초록색 학교 정체성과 네온 블루·보라·주황 포인트 조합

### 10.2 학생용 터치 기준

- 기본 본문 18px 이상
- 주요 버튼 높이 56px 이상
- 터치 영역 최소 48×48px
- 태블릿 가로 화면 1280×800을 우선
- 세로 화면과 1024×768에서도 기능이 잘리지 않아야 함
- 색상만으로 성공·실패를 구분하지 않고 아이콘과 문구를 함께 표시

### 10.3 아이콘

일반 기능 아이콘은 Material Symbols Rounded를 사용한다. 네트워크가 불안정한 학교에서도 표시되도록 가능하면 프로젝트에 폰트를 포함해 자체 제공한다.

권장 이름:

- home
- arrow_back
- close
- qr_code_scanner
- refresh
- check_circle
- lock
- schedule
- emoji_events
- leaderboard
- swap_horiz
- download
- volume_up
- volume_off
- fullscreen
- settings

중요 버튼은 아이콘만 두지 말고 한국어 문구를 함께 넣는다.

## 11. 이미지 자산

프로젝트의 public/assets/festival 폴더에 다음 WebP 파일을 사용한다.

### 대표 및 미션

- hero-main.webp
- mission-goldenbell.webp
- mission-error-hunt.webp
- mission-draw.webp
- mission-ozobot.webp
- mission-library-check.webp

### 카드

- card-thinking.webp
- card-observation.webp
- card-expression.webp
- card-command.webp
- card-verification.webp
- card-back.webp

### 장면

- scene-card-draw.webp
- scene-card-exchange.webp
- scene-finale.webp

### 투명 배경 마스코트

- mascot-welcome.webp
- mascot-correct.webp
- mascot-retry.webp
- mascot-timer.webp
- mascot-hint.webp
- mascot-card-earned.webp

학교 로고는 public/assets/brand/school-logo.png에 둔다. 로고는 시작 화면과 교사용 화면 머리글에 작게 사용하며, 왜곡하거나 색을 임의로 바꾸지 않는다.

모든 이미지에는 의미 있는 대체 텍스트를 제공한다. 장식 이미지는 빈 대체 텍스트를 사용한다.

## 12. 기술 구성

### 12.1 권장 스택

- React
- TypeScript
- Vite
- React Router
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- Vitest
- Testing Library
- ESLint
- Prettier

필요한 패키지만 추가한다. 대형 UI 프레임워크는 사용하지 않고 CSS 변수와 재사용 컴포넌트로 디자인 시스템을 만든다. 그림판은 HTML Canvas API로 구현한다.

### 12.2 데이터 소스 분리

UI가 Firebase 코드에 직접 의존하지 않도록 저장소 인터페이스를 둔다.

    src/data/EventRepository.ts
    src/data/mock/MockEventRepository.ts
    src/data/firebase/FirestoreEventRepository.ts

환경 변수 VITE_DATA_MODE가 mock이면 로컬 샘플 데이터를, firebase이면 Firestore를 사용한다.

이 구조를 통해 1차 목업을 먼저 완성하고 Firebase 설정 전에도 전체 흐름을 테스트한다.

### 12.3 기본 폴더 구조

    src/
      app/
      components/
      features/
        join/
        tour/
        missions/
          goldenBell/
          errorHunt/
          drawing/
          ozobot/
          libraryCheck/
        cards/
        exchange/
        teacher/
      data/
        mock/
        firebase/
      domain/
      hooks/
      styles/
      test/

## 13. Firebase 무료 운영 원칙

목표는 결제 수단을 등록하지 않는 Spark 요금제 범위에서 행사하는 것이다.

사용:

- Firebase Authentication의 익명 로그인
- 교사용 Google 로그인
- Cloud Firestore
- Firebase Hosting

기본적으로 사용하지 않음:

- Cloud Storage for Firebase
- Cloud Functions
- Firebase App Hosting
- 전화번호 인증
- Firebase AI Logic 또는 외부 유료 AI API
- 그 밖의 결제 계정이 필요한 기능

2026년 9월 기준 Spark 플랜의 대표 한도는 Firestore 저장 1GiB, 읽기 5만 건/일, 쓰기 2만 건/일, 삭제 2만 건/일, Hosting 저장 10GB, 전송 360MB/일이다. 가격과 정책은 바뀔 수 있으므로 배포 전에 공식 가격표를 다시 확인한다.

공식 참고:

- https://firebase.google.com/pricing
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024

Cloud Storage for Firebase는 2026년부터 Blaze 요금제가 필요하므로 사용하지 않는다. 그림은 압축하여 Firestore에 임시 저장하되 읽기를 최소화한다.

## 14. 데이터 모델

모든 데이터는 events 아래에 행사별로 분리한다.

### 14.1 주요 문서

#### teachers/{uid}

    displayName: string
    email: string
    role: "teacher" | "admin"
    active: boolean

#### events/{eventId}

    title: string
    schoolName: string
    status: "draft" | "ready" | "active" | "paused" | "exchange" | "completed"
    activeGrade: 3 | 4 | 5 | 6 | null
    activeRound: 0 | 1 | 2 | 3 | 4 | 5
    roundEndsAt: timestamp | null
    createdAt: timestamp
    updatedAt: timestamp

#### events/{eventId}/classes/{classId}

    grade: 3 | 4 | 5 | 6
    classNo: number
    displayName: string
    status: "ready" | "touring" | "exchange" | "complete"

#### events/{eventId}/teams/{teamId}

    classId: string
    grade: number
    classNo: number
    teamNo: 1 | 2 | 3 | 4 | 5
    displayName: string
    status: "ready" | "active" | "finished"
    lockedSessionUid: string | null
    createdAt: timestamp
    updatedAt: timestamp

#### events/{eventId}/sessions/{uid}

    uid: string
    teamId: string
    createdAt: timestamp
    lastSeenAt: timestamp

학생이 처음 팀 링크에 들어오면 익명 로그인 UID를 한 팀에 연결한다. 같은 브라우저에서는 그 팀 연결을 유지한다. 팀 변경은 교사가 잠금을 해제할 때만 허용한다.

#### events/{eventId}/missions/{missionId}

    type: "golden_bell" | "error_hunt" | "drawing" | "ozobot" | "library_check"
    title: string
    room: string
    enabled: boolean
    config: map

#### events/{eventId}/rounds/{roundId}

    grade: number
    roundNo: number
    status: "waiting" | "active" | "scoring" | "closed"
    startedAt: timestamp | null
    endsAt: timestamp | null

#### events/{eventId}/submissions/{submissionId}

    teamId: string
    classId: string
    missionId: string
    roundNo: number
    status: "draft" | "submitted" | "verified"
    answer: map
    score: number | null
    submittedAt: timestamp | null
    updatedAt: timestamp

그림 제출은 일반 제출과 분리한다.

#### events/{eventId}/drawingSubmissions/{teamId}

    teamId: string
    promptId: string
    mimeType: "image/webp"
    byteSize: number
    width: number
    height: number
    imageBytes: bytes
    submittedAt: timestamp

imageBytes 필드는 인덱스에서 제외한다.

#### events/{eventId}/results/{resultId}

    missionId: string
    grade: number
    roundNo: number
    teamId: string
    score: number
    rank: number
    finalizedBy: string
    finalizedAt: timestamp

#### events/{eventId}/drawTickets/{ticketId}

    teamId: string
    classId: string
    sourceResultId: string
    cardType: "thinking" | "observation" | "expression" | "command" | "verification"
    claimedAt: timestamp | null
    createdAt: timestamp

#### events/{eventId}/exchanges/{exchangeId}

    requestId: string
    fromClassId: string
    toClassId: string
    cardType: string
    quantity: number
    status: "completed" | "reversed"
    createdBy: string
    createdAt: timestamp
    reversesExchangeId: string | null

### 14.2 원본 데이터 원칙

- 미션 순위의 원본은 results
- 카드 획득의 원본은 claimed drawTickets
- 카드 교환의 원본은 exchanges
- 카드함의 수량은 위 기록을 합산하여 계산
- 성능이 필요하면 계산 결과를 별도 요약 문서에 캐시하되, 원장과 불일치하면 원장을 우선

## 15. 인증과 보안

### 교사

- Google 로그인 사용
- teachers/{uid} 문서에 등록되고 active가 true인 계정만 교사 기능 허용
- 교사 등록은 Firebase 콘솔 또는 관리자만 수행
- 브라우저 코드에 교사 비밀번호, 관리자 PIN, 서비스 계정 키를 넣지 않음

### 학생

- Firebase 익명 인증 사용
- QR은 eventId와 teamId를 포함
- 최초 입장한 UID를 팀 세션으로 잠금
- 학생은 자기 팀 제출물만 생성·수정 가능
- 순위, 카드 종류, 교환 기록은 학생이 변경할 수 없음

서버 없는 Spark 플랜 구조이므로 QR 링크 자체가 시험 수준의 강한 인증은 아니다. 이 프로그램은 학교 행사 운영용이며 민감정보와 성적을 저장하지 않는다. 악의적 공격까지 막아야 한다면 별도 서버나 유료 기능이 필요한 보안 설계를 다시 해야 한다.

### 개인정보

- 학생 이름, 학번, 이메일 수집 금지
- 팀 식별자는 “4학년 2반 3팀” 수준
- 그림에 이름을 쓰지 않도록 안내
- 행사 종료 후 그림 제출 데이터 삭제
- 로그에는 필요한 오류 정보만 기록

## 16. 동시성 및 데이터 무결성

- 카드 교환은 Firestore 트랜잭션 사용
- 카드 뽑기권 사용은 claimedAt이 null일 때만 성공
- 동일 제출 중복 방지를 위해 미션·팀별 고정 문서 ID 사용
- 교사 순위 확정 버튼은 중복 클릭돼도 같은 결과가 나오도록 설계
- 쓰기 요청에는 requestId를 포함
- 서버 시각을 기준으로 순서 기록
- 그림 문서는 실시간 구독하지 않고 교사가 열 때만 읽기
- 대시보드 구독 범위를 현재 학년과 현재 라운드로 제한

## 17. 연결 장애 대응

- 연결 상태를 화면 상단에 명확히 표시
- 제출 중에는 버튼 비활성화와 진행 표시
- 실패하면 입력 내용을 유지하고 재시도 버튼 제공
- 타이머는 서버 종료 시각을 기준으로 계산하되 화면 갱신은 브라우저에서 수행
- 같은 제출을 재전송해도 중복 생성되지 않도록 고정 ID 사용
- 교사 화면에 모든 결과 수동 입력·수정 기능 제공
- 행사 전 종이 순위표와 카드 기록표를 예비 운영안으로 준비

PWA와 완전한 오프라인 쓰기 지원은 MVP 이후 선택 기능이다.

## 18. 성능 목표

- 첫 화면의 핵심 UI가 학교 Wi-Fi에서 3초 이내 표시
- 대표 이미지 외의 미션 이미지는 필요할 때 지연 로딩
- WebP 자산 사용
- 카드 목록과 제출 목록은 필요한 범위만 조회
- 실시간 구독은 진행 상태처럼 작은 문서에만 사용
- 이미지가 있는 문서는 별도 경로로 분리
- 같은 이미지를 반복 내려받지 않도록 브라우저 캐시 활용

## 19. 접근성 및 사용성

- 모든 입력에 연결된 라벨 제공
- 키보드만으로 교사용 기능 사용 가능
- 포커스 표시 제거 금지
- 성공, 경고, 실패를 색과 함께 문구·아이콘으로 표시
- 애니메이션 감소 설정을 존중
- 카드 뒤집기나 축하 효과는 소리 없이도 의미가 전달되어야 함
- 실수하기 쉬운 초기화·교환 확정에는 확인 단계 제공

## 20. MVP 범위

### 포함

- 학생 QR 링크 입장
- 팀 홈과 자동 미션 순환 안내
- 5종 미션 화면
- 학생 제출
- 교사 진행·채점·순위 확정
- 카드 뽑기와 카드함
- 학급 카드 교환
- 전체 현황
- 그림 제출 일괄 다운로드
- 행사 데이터 내보내기
- 모바일·태블릿 반응형

### 제외

- 프로그램 내부 생성형 AI 호출
- 자동 AI 그림 채점
- 오조봇 하드웨어 직접 연동
- 학생 개인 계정
- 학생 개인 순위
- 결제 기능
- 문자 인증
- Cloud Functions
- Cloud Storage
- 복잡한 분석 대시보드
- 여러 학교를 동시에 운영하는 SaaS 기능

## 21. 개발 단계

### 1단계: 로컬 목업

- React 프로젝트 생성
- 디자인 토큰과 공통 레이아웃
- 제공 이미지 연결
- 학생 주요 화면
- 교사 대시보드 주요 화면
- MockEventRepository
- 전체 동선 클릭 테스트

완료 조건: Firebase 없이도 한 팀이 입장부터 카드 확인까지 모든 화면을 둘러볼 수 있다.

### 2단계: Firebase 기반

- 익명 인증과 교사 Google 로그인
- Firestore 컬렉션과 보안 규칙
- 샘플 행사 생성 스크립트
- 팀 세션 잠금
- 실시간 라운드 상태

완료 조건: 두 브라우저에서 교사가 라운드를 시작하면 학생 화면이 바뀐다.

### 3단계: 웹 자동 미션

- AI 골든벨
- AI 틀린그림 찾기
- 자동 점수와 제출
- 교사 순위 확정

완료 조건: 6팀이 동시에 제출해도 점수와 순위가 정상 표시된다.

### 4단계: 교사 판정 미션

- 설명대로 그려라
- 그림 압축·임시 저장·일괄 다운로드
- 로봇 길찾기 기록
- 도서관 오류찾기 제출·채점

완료 조건: 그림과 텍스트 제출을 교사가 모아 확인하고 순위를 확정할 수 있다.

### 5단계: 카드와 교환

- 순위별 뽑기권 발급
- 카드 뒤집기
- 팀·학급 카드함
- 트랜잭션 기반 학급 교환
- 컬렉션 완성 피날레

완료 조건: 중복 클릭이나 새로고침으로 카드가 추가 지급되지 않는다.

### 6단계: 리허설과 배포

- 30팀 부하 리허설
- 기기별 화면 확인
- Firebase 규칙 테스트
- CSV·JSON 내보내기
- 장애 복구 연습
- Firebase Hosting 배포

완료 조건: 교사가 개발자 도움 없이 행사 생성, 시작, 판정, 교환, 종료를 수행한다.

## 22. 핵심 인수 조건

1. 3~6학년의 학급 수와 학급당 5팀을 정확히 생성할 수 있다.
2. 팀 번호에 따라 5개 미션이 겹치지 않게 순환한다.
3. 새로고침해도 팀 연결과 제출 상태가 유지된다.
4. 학생은 자기 팀 제출 외의 데이터를 수정할 수 없다.
5. 교사가 확정한 순위에 따라 3장, 2장, 1장의 뽑기권이 정확히 생성된다.
6. 뽑기권 하나로 카드를 두 번 뽑을 수 없다.
7. 학급 카드 수량은 획득과 교환 기록의 합과 일치한다.
8. 카드 교환 중 어느 한쪽 수량이 음수가 되지 않는다.
9. 그림이 300KB 목표를 넘으면 재압축하고, 350KB를 넘으면 제출하지 않는다.
10. 교사는 그림을 팀 정보가 포함된 파일명으로 일괄 다운로드할 수 있다.
11. 모든 핵심 기능에 교사용 수동 수정 경로가 있다.
12. 앱 내부에서 유료 AI API나 결제 필요 기능을 호출하지 않는다.
13. 태블릿 가로 화면에서 스크롤 없이 주요 행동 버튼을 볼 수 있다.
14. 연결 실패 시 입력 데이터가 사라지지 않고 재시도할 수 있다.
15. 행사 종료 후 그림 데이터만 선택적으로 삭제할 수 있다.

## 23. 초기 샘플 데이터

개발용 기본 행사는 다음 값으로 만든다.

- eventId: songjeong-ai-festival-2026
- 행사명: 2026 송정 AI 페스티벌
- 학교명: 서울송정초등학교
- 학년: 3, 4, 5, 6
- 학급 수: 4, 5, 6, 5
- 학급당 팀 수: 5
- 카드 확률: 각 20퍼센트
- 순위 보상: 3, 2, 1
- 라운드 활동: 8분
- 이동: 2분

Mock 데이터는 4학년 2반 3팀이 2라운드에 참여 중이며, 카드 2장을 보유한 상태로 시작해 여러 화면 상태를 확인할 수 있게 한다.

## 24. 변경이 필요한 미확정 항목

다음은 실제 운영 전 교사가 확정해야 하며, 코드에 고정하지 않고 행사 설정으로 둔다.

- 각 미션의 교실 번호
- 학년별 행사 시작 시각
- 골든벨 실제 문제와 해설
- 틀린그림 이미지와 정답 영역
- 그리기 설명 문장
- 오조봇 코스와 감점 규칙
- 도서관 오류찾기 글, 정답 요소, 참고 도서
- 카드 교환의 최종 승인 담당자
- 피날레에서 표시할 학급 보상 문구

---

이 문서는 제품 요구사항의 기준이다. 구현 중 판단이 충돌하면 재미있는 학생 경험, 교사의 쉬운 운영, 무료 운영, 데이터 안전 순서로 결정하고 변경 사항을 문서에 함께 반영한다.
