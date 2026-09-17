# 송정 AI 페스티벌 웹 프로그램 개발 명세서

문서 버전: 1.2  
작성 기준일: 2026-09-17  
대상 학교: 서울송정초등학교  
행사 형태: 3~6학년 주간 하루형 AI 미션 투어

> **최신 운영 상세 명세:** 실시간 대시보드, QR 체크인, 네 조각 카드 성장, 공통 힌트, 학급 전체 최종 미션과 순위는 `CARD_FINALE_UPDATE_SPEC.md` 버전 3.0을 적용한다. 충돌 시 해당 문서를 우선한다.

## 1. 제품 한눈에 보기

송정 AI 페스티벌 웹 프로그램은 학생들이 5개의 AI 미션 교실을 순환하고, 순위에 따른 카드 종류 선택권으로 학급의 5종 능력 카드를 네 조각씩 완성한 뒤, 완성 카드 종류 수만큼 공통 힌트를 활용해 학급 전체 최종 미션에 도전하는 행사 운영 도구다.

핵심 경험은 다음과 같다.

1. 학생은 팀 QR을 찍고 자기 팀 화면에 들어간다.
2. 5개 팀이 서로 다른 미션에서 출발해 10분마다 다음 미션으로 이동한다.
3. 미션별 결과와 순위에 따라 카드 종류를 선택하거나 자동 배정받는다.
4. 같은 종류를 얻을 때마다 학급 카드의 다음 조각이 열리고 4조각이면 완성된다.
5. 완성한 카드 종류 수만큼 최종 미션에서 공통 힌트를 사용할 수 있다.
6. 각 반은 준비되었을 때 시작하고 학급 전체가 전자칠판으로 10문제를 함께 푼다.
7. 정답 수, 5종 카드 완성 여부, 실제 소요 시간 순으로 최종 순위를 정한다.
8. 교사는 대시보드에서 팀 위치, 미션 상태, 카드 성장, 최종 미션을 실시간으로 관리한다.

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
| 학급 최종 미션 | 미션 투어 이후 기본 12분, 행사 설정 가능 |

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

학급 최종 미션은 60분 투어와 분리하여 각 교실에서 기본 12분간 진행한다. 실제 운영 시간은 행사 설정에서 조정한다.

## 5. 사용자 역할

### 5.1 학생 팀

- QR 링크로 팀 화면 입장
- 학년, 반, 팀 번호 확인
- 현재 미션과 다음 이동 장소 확인
- 웹 미션 수행 및 결과 제출
- 부여된 카드 종류 후보 중 하나 선택 또는 자동 배정 결과 확인
- 학급 카드 5종의 네 조각 진행 상황 확인
- 미션 교실 QR 체크인과 학급 카드 현황 확인

학생 개인 계정과 이름은 수집하지 않는다.

### 5.2 미션 담당 교사

- Google 계정으로 로그인
- 전체 대시보드는 읽기 전용으로 확인
- 담당 미션의 예정 팀과 QR 체크인 여부 확인
- 담당 미션의 현재 라운드 시작·일시정지·종료
- 제출 현황 확인
- 수동 채점 또는 순위 확정
- 순위에 따른 카드 종류 후보 생성 및 보상 확정
- 오류 제출 취소와 재제출 허용

### 5.3 총괄 관리자

- 행사, 학년, 학급, 팀 생성
- 미션 문제와 정답 설정
- 라운드 상태 일괄 제어
- 실시간 팀 위치·상태와 미도착·오입장·결과 미입력 확인
- 학년별 최종 미션 개방과 결과 공개
- 결과를 CSV 또는 JSON으로 내보내기
- 리허설 데이터 초기화

### 5.4 담임교사

- Google 계정으로 로그인
- 전체 대시보드는 읽기 전용으로 확인
- 담당 학급의 팀 위치, 미션 결과, 카드 진행도 확인
- 총괄 운영자가 최종 미션을 연 뒤 담당 학급의 최종 미션 시작
- 전자칠판에서 10문제 풀이와 최종 제출 진행

초기 버전에서는 부스 교사, 담임교사, 총괄 관리자를 하나의 교사용 앱 안에서 역할값으로 구분한다.

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

| 미션 순위 | 카드 종류 결정 방식 |
| --- | --- |
| 1위 | 서로 다른 카드 종류 3개 중 1개 선택 |
| 2위 | 서로 다른 카드 종류 2개 중 1개 선택 |
| 3위 이하 | 카드 종류 1개 무작위 자동 배정 |

참가 팀이 4~6팀이어도 같은 규칙을 사용하며 모든 팀은 미션마다 조각 하나를 얻는다. 후보 종류는 5종에서 같은 확률로 만들고 한 보상 안에서 중복시키지 않는다.

카드 종류는 다음 5개다.

| 카드 | 연결 미션 | 의미 |
| --- | --- | --- |
| 생각 카드 | AI 골든벨 | 질문하고 판단하는 힘 |
| 관찰 카드 | 틀린그림 찾기 | 자세히 보고 차이를 찾는 힘 |
| 표현 카드 | 설명대로 그려라 | 생각을 그림으로 나타내는 힘 |
| 명령 카드 | 로봇 길찾기 | 순서와 규칙으로 움직이게 하는 힘 |
| 검증 카드 | AI 오류찾기 | 근거를 찾아 사실을 확인하는 힘 |

카드 성장 규칙:

- 카드 진행도는 팀이 아니라 학급 단위로 계산
- 같은 종류를 얻을 때마다 다음 조각이 열려 `0/4`에서 `4/4`까지 성장
- 권장 공개 순서는 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래
- 5회 이상 획득은 진행도를 `4/4`로 유지하고 `중복 +N`으로만 기록
- 중복 조각 교환과 재조합은 없음
- 교사가 순위를 확정할 때 결과 하나당 카드 보상 원장 하나만 생성
- 1·2위 학생은 현재 학급 카드 현황을 보고 제시된 후보 안에서 선택
- 학생은 후보에 없는 카드 종류를 선택할 수 없음
- 새로고침이나 버튼 연타로 같은 보상을 두 번 받을 수 없음

카드 진행도는 claimed `cardAwards` 원장을 학급별로 집계하여 계산한다.

## 8. 실시간 운영 대시보드와 학급 최종 미션

팀이 미션 교실 QR을 찍으면 대시보드에 입장 상태가 표시된다. 부스 교사가 미션을 시작하고 결과를 확정하면 진행 중·완료 상태와 카드 보상이 실시간으로 갱신된다. 총괄 운영자는 미션별 보기와 학급별 보기에서 모든 팀의 현재 위치, 다음 미션, 완료 여부, 미도착·오입장·결과 미입력 경고를 확인한다.

미션 투어가 끝나면 총괄 운영자가 해당 학년의 최종 미션을 연다. 각 반은 준비되었을 때 담임교사 대시보드에서 시작하며, 시작 시각은 달라도 실제 소요 시간을 서버 시각으로 계산한다.

학급 전체가 전자칠판으로 10개의 4지선다형 문제를 함께 푼다. 완성 카드 종류 수만큼 힌트를 사용할 수 있으며, 모든 힌트는 현재 문제의 오답 보기 하나를 제거한다. 카드 종류별 효과와 AI 마스터 찬스는 사용하지 않는다.

최종 순위는 `정답 수 내림차순 → 5종 카드 완성 여부 → 소요 시간 오름차순`으로 정한다. 진행 중에는 다른 반의 점수와 순위를 숨기고, 같은 학년의 모든 반이 제출한 뒤 결과를 공개한다.

세부 화면, 상태, 데이터 모델, 복구와 테스트는 `CARD_FINALE_UPDATE_SPEC.md` 버전 3.0을 따른다.

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
| /team/:eventId/:teamId/reward | 순위별 카드 종류 선택·자동 배정 결과 |
| /team/:eventId/:teamId/cards | 학급 카드 5종의 네 조각 진행도 |
| /team/:eventId/:teamId/check-in/:stationId | 미션 교실 QR 체크인 결과 |
| /check-in/:eventId/:stationId | 교실에 붙이는 QR 주소. 기기에 입장한 팀의 체크인 화면으로 이동 |

### 9.3 교사 화면

| 경로 | 화면 |
| --- | --- |
| /teacher/login | Google 로그인 |
| /teacher/:eventId/dashboard | 실시간 전체 운영 대시보드 |
| /teacher/:eventId/station/:missionId | 미션 진행·채점 |
| /teacher/:eventId/class/:classId | 학급 카드함 |
| /teacher/:eventId/class/:classId/final | 학급 전체 10문제 최종 미션 |
| /teacher/:eventId/final-results | 학년별 최종 결과와 순위 |
| /teacher/:eventId/qr | 팀 입장 QR과 미션 교실 도착 QR 인쇄(A4). `?station=미션ID`면 그 교실 한 장 |
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
- master-chance-emblem.webp (구버전 자산, 신규 화면에서 사용하지 않음)

### 장면

- scene-card-draw.webp
- scene-card-exchange.webp (구버전 자산, 신규 화면에서 사용하지 않음)
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

구현 메모:

- 저장소는 `capabilities`(`liveOps`, `classFinal`)로 연결된 기능을 알린다. mock과 Firestore 저장소 모두 켜져 있다. 새 기능을 아직 연결하지 못한 저장소는 값을 꺼 두고, 화면은 꺼진 기능의 메뉴와 버튼을 숨긴다.
- Firestore 저장소는 대시보드·부스·최종 미션 현황을 실시간 구독 캐시에서 만든다. 화면을 다시 그릴 때마다 문서를 다시 읽지 않아, 읽기는 "바뀐 문서 수 × 보고 있는 교사 수"만큼만 든다.
- 최근 활동은 별도 컬렉션에 쓰지 않고 구독 중인 문서(체크인, 부스, 라운드, 카드 보상, 최종 미션)의 시각으로 만든다.
- 남은 시간, 미도착 판정, 최종 미션 소요 시간처럼 시각이 기준인 계산은 기기 시계(`Date.now()`)가 아니라 저장소의 `serverNow()`를 쓴다.
- 정답과 힌트로 지울 보기는 저장소 안에만 두고 화면에는 문제와 보기만 내려 준다. 진행 중에는 정답 수도 내려 주지 않는다.

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
        dashboard/
        final/
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
    role: "admin" | "station_teacher" | "homeroom_teacher"
    missionId: string | null   (부스 교사의 담당 미션. 비어 있으면 모든 부스)
    classId: string | null     (담임교사의 담당 학급, 예: g4-c2)
    active: boolean

예전 값 role: "teacher"는 담당이 정해지지 않은 부스 교사로 취급한다.

#### events/{eventId}

    title: string
    schoolName: string
    status: "draft" | "ready" | "active" | "paused" | "final" | "completed"
    activeGrade: 3 | 4 | 5 | 6 | null
    activeRound: 0 | 1 | 2 | 3 | 4 | 5
    roundEndsAt: timestamp | null
    createdAt: timestamp
    updatedAt: timestamp

#### events/{eventId}/classes/{classId}

    grade: 3 | 4 | 5 | 6
    classNo: number
    displayName: string
    status: "ready" | "touring" | "final_ready" | "final_active" | "complete"

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

기기(익명 로그인 uid) 하나를 한 팀에 묶는다. 교사가 학급 화면에서 이 문서를 지우면 잠금이 풀려
그 기기는 다시 팀을 골라 입장할 수 있다. 화면의 "기기 번호"는 uid의 끝 네 글자다.

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

#### events/{eventId}/cardAwards/{awardId}

    resultId: string
    grade: 3 | 4 | 5 | 6
    classId: string
    teamId: string
    missionId: string
    roundNo: 1 | 2 | 3 | 4 | 5
    rank: number
    selectionMode: "choose_three" | "choose_two" | "automatic"
    offeredTypes: CardType[]
    selectedType: CardType | null
    status: "pending" | "claimed"
    createdAt: timestamp
    claimedAt: timestamp | null

#### events/{eventId}/teamMissionStates/{classId_teamNo_roundNo}

교실 QR 체크인 기록. 진행 중·완료와 시간 경고는 저장하지 않고 부스 문서와 라운드 시각으로 계산한다.

    grade: number
    classId: string
    teamId: string
    teamNo: 1 | 2 | 3 | 4 | 5
    roundNo: 1 | 2 | 3 | 4 | 5
    expectedMissionId: string
    actualMissionId: string | null
    wrongStationId: string | null     (다른 교실 QR을 찍은 기록. 올바르게 입장하면 null)
    manualReview: boolean
    checkedInAt: timestamp | null     (서버 시각)
    checkedInBy: "team" | "teacher" | null
    updatedAt: timestamp

#### events/{eventId}/missionRoundStates/{missionId_gGrade_rRoundNo}

    grade: number
    missionId: string
    roundNo: number
    status: "active" | "completed"    (화면의 scoring은 라운드 상태로 계산)
    startedAt: timestamp | null
    completedAt: timestamp | null
    resultFinalizedAt: timestamp | null
    resultTeamIds: string[]           (순위를 확정한 팀. 대시보드가 results를 다시 읽지 않게 하는 요약)
    updatedBy: string | null
    updatedAt: timestamp

#### events/{eventId}/clockSync/{uid}

기기 시계와 서버 시계의 차이를 재는 문서. 자기 문서에 서버 시각만 적을 수 있다.

    at: timestamp

#### events/{eventId}/finalSessions/{grade}

    grade: number
    status: "locked" | "open" | "results_published" | "closed"
            (results_hidden은 저장하지 않고 "모든 반 제출 + 공개 전"이면 화면에서 계산)
    questionCount: 10
    durationLimitSec: number
    openedAt: timestamp | null
    openedBy: string | null
    forceOpenReason: string | null
    resultsPublishedAt: timestamp | null
    lastReset: { classId, reason, by, at } | 없음

#### events/{eventId}/finalQuestionSets/{grade}

교사만 읽는다. 정답은 들어 있지 않다.

    grade: number
    questions: [{ id, area, text, passage, choices: [{ id, label }] × 4, hintRemoveChoiceId }] × 10

#### events/{eventId}/finalAnswerKeys/{grade}

총괄 운영자만 읽는다. 채점은 총괄 운영자 기기에서 하고 결과를 공개할 때 학급 상태에 기록한다.

    grade: number
    answers: { [questionId]: choiceId }

#### events/{eventId}/finalResponses/{classId}

읽기를 아끼려고 학급당 문서 하나에 문제 번호("0"~"9")별로 모은다.
보안 규칙은 지금 푸는 번호만 바꿀 수 있게 해서 확정한 답을 나중에 고치지 못하게 한다.

    classId: string
    grade: number
    answers: {
      "0": { questionId, selectedChoiceId, hintUsed, removedChoiceId,
             confirmedAt: timestamp | null, hintRequestId?, confirmRequestId?, updatedAt }
    }
    updatedAt: timestamp

#### events/{eventId}/finalClassStates/{classId}

문서가 없으면 시작 전(ready)이다. 초기화는 문서를 지운다.

    classId: string
    grade: number
    status: "active" | "submitted" | "timeout"   (locked·ready·review_required는 화면에서 계산)
    currentQuestionIndex: number
    completedCardTypeCountSnapshot: number
    allFiveCardsCompletedSnapshot: boolean
    hintTotal: number
    hintUsed: number
    questionCount: number             (시작할 때 세션 값을 복사. 규칙이 세션을 다시 읽지 않게 한다)
    durationLimitSec: number
    startedAt: timestamp              (서버 시각)
    submittedAt: timestamp | null     (서버 시각)
    durationMs: number | null         (결과 공개·보정 때 기록. 그 전에는 제출 시각 - 시작 시각으로 계산)
    correctCount: number | null       (결과 공개·보정 때 총괄 운영자가 기록)
    finalRank: number | null
    manualOverride: boolean
    overrideReason: string | null
    overrideBy: string | null
    startRequestId: string | null
    updatedAt: timestamp

### 14.2 원본 데이터 원칙

- 미션 순위의 원본은 results
- 카드 획득과 진행도의 원본은 claimed cardAwards
- 팀의 미션 위치·상태 원본은 teamMissionStates
- 최종 문제 응답 원본은 finalResponses
- 최종 학급 상태, 점수, 시작·제출 시각의 원본은 finalClassStates
- 카드 진행도는 학급별 selectedType 기록을 합산하여 최대 4까지 계산하고 초과분은 중복 수로 표시
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
- 순위와 카드 후보는 학생이 변경할 수 없고, 1·2위 학생은 자기 보상의 offeredTypes 안에서만 selectedType을 확정할 수 있음

서버 없는 Spark 플랜 구조이므로 QR 링크 자체가 시험 수준의 강한 인증은 아니다. 이 프로그램은 학교 행사 운영용이며 민감정보와 성적을 저장하지 않는다. 악의적 공격까지 막아야 한다면 별도 서버나 유료 기능이 필요한 보안 설계를 다시 해야 한다.

### 개인정보

- 학생 이름, 학번, 이메일 수집 금지
- 팀 식별자는 “4학년 2반 3팀” 수준
- 그림에 이름을 쓰지 않도록 안내
- 행사 종료 후 그림 제출 데이터 삭제
- 로그에는 필요한 오류 정보만 기록

## 16. 동시성 및 데이터 무결성

- 카드 보상 생성은 결과 하나당 고정 문서 ID를 사용하여 한 번만 성공
- 카드 종류 선택은 status가 pending이고 selectedType이 offeredTypes에 포함될 때만 성공
- QR 체크인은 학급·팀·라운드별 고정 문서 ID로 중복을 막음
- 공통 힌트 사용은 문제별로 한 번만 기록하고 보유 수를 넘지 못하게 함
- 최종 미션 시작과 제출은 requestId로 중복을 막고 서버 시각으로 기록
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
- 타이머는 서버 시작 시각을 기준으로 계산하되 화면 갱신은 브라우저에서 수행
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
- 카드 조각 공개와 축하 효과는 소리 없이도 의미가 전달되어야 함
- 실수하기 쉬운 초기화·힌트 사용·최종 답안 제출에는 확인 단계 제공

## 20. MVP 범위

### 포함

- 학생 팀 QR 입장과 미션 교실 QR 체크인
- 팀 홈과 자동 미션 순환 안내
- 5종 미션 화면
- 학생 제출
- 교사 진행·채점·순위 확정
- 순위별 카드 종류 선택과 네 조각 카드 성장
- 완성 카드 종류 수만큼 공통 힌트
- 실시간 팀 위치·미션 상태 대시보드
- 반별로 시작하는 학급 전체 10문제 최종 미션과 자동 순위
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

### 5단계: 실시간 대시보드, 카드 성장과 학급 최종 미션

- 미션 교실 QR 체크인과 팀 이동 상태
- 미션별·학급별 실시간 운영 대시보드
- 순위별 카드 종류 후보 생성과 선택
- 학급 카드 5종의 네 조각 성장
- 완성 카드 종류 수만큼 공통 힌트
- 반별 시작, 학급 전체 10문제 풀이, 최종 순위

완료 조건: 모든 팀의 위치와 상태를 확인할 수 있고, 중복 클릭·새로고침에도 카드·힌트·최종 답안이 정확히 유지되며 최신 순위 규칙이 적용된다.

### 6단계: 리허설과 배포

- 30팀 부하 리허설
- 기기별 화면 확인
- Firebase 규칙 테스트
- CSV·JSON 내보내기
- 장애 복구 연습
- Firebase Hosting 배포

완료 조건: 교사가 개발자 도움 없이 행사 생성, 시작, 판정, 결승 진행, 종료를 수행한다.

## 22. 핵심 인수 조건

1. 3~6학년의 학급 수와 학급당 5팀을 정확히 생성할 수 있다.
2. 팀 번호에 따라 5개 미션이 겹치지 않게 순환한다.
3. 새로고침해도 팀 연결과 제출 상태가 유지된다.
4. 학생은 자기 팀 제출 외의 데이터를 수정할 수 없다.
5. 교사가 순위를 확정하면 모든 팀에 카드 보상 하나가 생성되고 1위 3종, 2위 2종, 나머지 1종 후보 규칙을 지킨다.
6. 학생은 offeredTypes 밖의 카드 종류를 선택할 수 없고 같은 보상을 두 번 받을 수 없다.
7. 학급 카드 진행도는 claimed cardAwards의 selectedType 합계와 일치하며 4를 넘는 획득은 중복 수로 계산한다.
8. 대시보드에서 어떤 학급의 어떤 팀이 어느 미션에 있는지 확인할 수 있다.
9. 미도착, 잘못된 교실, 결과 미입력 경고가 표시된다.
10. 완성 카드 종류 수와 최종 미션의 공통 힌트 수가 일치한다.
11. 학급 전체가 전자칠판에서 10개의 4지선다형 문제를 풀 수 있다.
12. 정답 수, 5종 완성 여부, 소요 시간 순으로 학급 순위를 정한다.
13. 그림이 300KB 목표를 넘으면 재압축하고, 350KB를 넘으면 제출하지 않는다.
14. 교사는 그림을 팀 정보가 포함된 파일명으로 일괄 다운로드할 수 있다.
15. 모든 핵심 기능에 교사용 수동 수정 경로가 있다.
16. 앱 내부에서 유료 AI API나 결제 필요 기능을 호출하지 않는다.
17. 태블릿 가로 화면에서 스크롤 없이 주요 행동 버튼을 볼 수 있다.
18. 연결 실패 시 입력 데이터가 사라지지 않고 재시도할 수 있다.
19. 행사 종료 후 그림 데이터만 선택적으로 삭제할 수 있다.

## 23. 초기 샘플 데이터

개발용 기본 행사는 다음 값으로 만든다.

- eventId: songjeong-ai-festival-2026
- 행사명: 2026 송정 AI 페스티벌
- 학교명: 서울송정초등학교
- 학년: 3, 4, 5, 6
- 학급 수: 4, 5, 6, 5
- 학급당 팀 수: 5
- 카드 후보 확률: 각 종류 동일
- 순위 보상: 1위 3종 중 선택, 2위 2종 중 선택, 3위 이하 자동 배정
- 카드 완성: 종류별 4조각
- 최종 미션 제한 시간: 기본 12분
- 최종 문제 수: 10문제
- 공통 힌트: 완성 카드 종류 수, 최대 5개
- 라운드 활동: 8분
- 이동: 2분

Mock 데이터는 4학년 2반 3팀이 2라운드에 참여 중인 상태, 정상 체크인·오입장·미도착 경고, 카드 진행도·중복·완성 종류 수, 최종 미션 진행·힌트 사용·제출 상태를 각각 확인할 수 있게 만든다.

현재 mock 샘플:

- 4학년: 2라운드를 시작한 지 2분 30초. 시청각실·컴퓨터실 부스는 미션을 시작했고, 2반 3팀과 4반 5팀은 미도착, 5반 4팀은 도서관 대신 과학실 QR을 찍었다(오입장). 1라운드 결과는 확정되어 카드 보상이 만들어져 있다.
- 3학년: 5라운드를 마치고 최종 미션이 열린 상태(결과 공개 전). 1반은 5종 완성·힌트 5개로 4번 문제를 푸는 중(힌트 1개 사용), 2반은 8문제 정답·6분 10초, 3반은 8문제 정답·7분 30초로 제출 완료, 4반은 시작 전이다.
- 5·6학년: 투어 시작 전.
- 최종 미션 샘플 문제는 `src/data/mock/finalQuestions.ts`의 10문제(영역별 2문제)이며 모든 학년이 같은 샘플을 쓴다. 실제 문제는 24장에 따라 교사가 정한다.

## 24. 변경이 필요한 미확정 항목

다음은 실제 운영 전 교사가 확정해야 하며, 코드에 고정하지 않고 행사 설정으로 둔다.

- 각 미션의 교실 번호
- 학년별 행사 시작 시각
- 골든벨 실제 문제와 해설
- 틀린그림 이미지와 정답 영역
- 그리기 설명 문장
- 오조봇 코스와 감점 규칙
- 도서관 오류찾기 글, 정답 요소, 참고 도서
- 학년별 최종 미션 개방 시각과 제한 시간
- 학년별 최종 10문제, 정답, 오답 제거 대상
- QR 미도착 경고 유예 시간
- 피날레에서 표시할 학급 보상 문구

---

이 문서는 제품 요구사항의 기준이다. 구현 중 판단이 충돌하면 재미있는 학생 경험, 교사의 쉬운 운영, 무료 운영, 데이터 안전 순서로 결정하고 변경 사항을 문서에 함께 반영한다.
