/** 행사 도메인 타입. 저장소 구현(mock, firebase)과 화면이 함께 사용한다. */

export type Grade = 3 | 4 | 5 | 6;
export type TeamNo = 1 | 2 | 3 | 4 | 5;
export type MissionNo = 1 | 2 | 3 | 4 | 5;
export type RoundNo = 1 | 2 | 3 | 4 | 5;

export type EventStatus = 'draft' | 'ready' | 'active' | 'paused' | 'final' | 'completed';
export type RoundStatus = 'waiting' | 'active' | 'scoring' | 'closed';
export type ClassStatus = 'ready' | 'touring' | 'final_ready' | 'final_active' | 'complete';
export type TeamStatus = 'ready' | 'active' | 'finished';

export type MissionType = 'golden_bell' | 'error_hunt' | 'drawing' | 'ozobot' | 'library_check';
export type CardType = 'thinking' | 'observation' | 'expression' | 'command' | 'verification';

/** 미션 공통 셸에서 보여 주는 팀 기준 미션 상태 */
export type MissionPhase = 'waiting' | 'active' | 'submitted' | 'scoring' | 'closed';

/**
 * 행사 상태. 라운드는 부스마다 선생님이 여닫으므로(2026-09-28) 행사 전체의 라운드는 없다.
 *
 * activeRound, roundEndsAt, roundEndedAt, boothStatus는 “한 팀이 보는 라운드”다.
 * 저장소가 학생 화면에 넘길 때 그 팀이 지금 가야 하는 부스의 상태로 채운다(scopeEventToTeam).
 * 교사 화면이 받는 전체 행사 상태에서는 늘 비어 있다(0, null).
 */
export interface FestivalEvent {
  id: string;
  title: string;
  schoolName: string;
  /** 팀이 보는 값: 그 팀의 부스가 게임 중이면 active. 전체 상태: 진행할 학년을 골랐으면 active */
  status: EventStatus;
  activeGrade: Grade | null;
  /** 팀이 지금 하고 있는 라운드. 부스에 들어가기 전이면 앞 라운드(첫 라운드 전이면 0) */
  activeRound: 0 | RoundNo;
  /** 지금 게임이 끝나는 시각(epoch ms). 지나면 제출할 수 없다. */
  roundEndsAt: number | null;
  /** 앞 라운드를 끝낸 시각(epoch ms). 다음 부스로 이동하는 동안에만 있다. */
  roundEndedAt: number | null;
  /** 팀이 지금 가야 하는 부스의 단계. 투어 중이 아니면 null */
  boothStatus: MissionRoundStatus | null;
  /** 팀이 도는 라운드 가운데 부스가 건너뛴 라운드. 전체 행사 상태에서는 늘 비어 있다. */
  skippedRounds: RoundNo[];
  /** 게임 한 번의 시간(ms). 부스에서 “게임 시작”을 누른 때부터 센다. */
  gameDurationMs: number;
  updatedAt: number;
}

export interface ClassInfo {
  id: string;
  grade: Grade;
  classNo: number;
  displayName: string;
  status: ClassStatus;
}

export interface Team {
  id: string;
  classId: string;
  grade: Grade;
  classNo: number;
  teamNo: TeamNo;
  displayName: string;
  status: TeamStatus;
}

/** 골든벨 문제 형식: O/X, 객관식, 단답형 */
export type GoldenBellQuestionKind = 'ox' | 'choice' | 'short';

/** 골든벨 난이도: 하·중·상 */
export type GoldenBellLevel = 'low' | 'mid' | 'high';

export interface GoldenBellQuestion {
  /** 문제를 고쳐도 학생 답이 따라가도록 고정한 ID */
  id: string;
  /** 문제 형식. 없으면 객관식이다(예전에 저장한 문제). */
  kind?: GoldenBellQuestionKind;
  question: string;
  /** O/X와 객관식의 보기. O/X는 늘 ['O', 'X']이고 단답형은 비어 있다. */
  choices: string[];
  /** 정답 보기 번호(0부터). 단답형은 쓰지 않는다. */
  answerIndex: number;
  /** 단답형 정답. 첫 번째가 대표 정답이고 나머지는 함께 인정하는 답이다. */
  answers?: string[];
  /** 단답형 힌트(초성 등) */
  hint?: string;
  level?: GoldenBellLevel;
  /** 영역(AI 이해·AI 윤리·AI 활용 등) */
  area?: string;
  explanation: string;
}

/** 골든벨 문제 목록. 교사가 미션 운영 화면에서 등록하거나 문제 파일로 올린다. */
export interface GoldenBellConfig {
  type: 'golden_bell';
  /** 학년 공통 문제. 학년별 문제가 없는 학년이 쓴다. */
  questions: GoldenBellQuestion[];
  /** 학년별 문제. 등록한 학년은 공통 문제 대신 이 문제를 쓴다. */
  gradeQuestions?: Partial<Record<Grade, GoldenBellQuestion[]>>;
}

/** 정답 영역(원 또는 타원). 좌표와 반지름은 이미지 너비·높이에 대한 0~1 비율이다. */
export interface CircleRegion {
  id: string;
  x: number;
  y: number;
  /** 가로 반지름: 이미지 너비에 대한 비율 */
  r: number;
  /** 세로 반지름: 이미지 높이에 대한 비율. 없으면 가로 반지름과 같은 길이의 원이다. */
  ry?: number;
  label: string;
}

/** 틀린그림 찾기의 학년 묶음. 같은 묶음은 같은 그림을 쓴다. */
export type ErrorHuntBand = 'grade3' | 'grade4' | 'grade56';

/** 틀린그림 찾기 그림(asset manifest의 키) */
export type ErrorHuntImageKey =
  | 'missionErrorHunt'
  | 'huntG3_1'
  | 'huntG3_2'
  | 'huntG3_3'
  | 'huntG3_4'
  | 'huntG3_5'
  | 'huntG4_1'
  | 'huntG4_2'
  | 'huntG4_3'
  | 'huntG4_4'
  | 'huntG4_5'
  | 'huntG56_1'
  | 'huntG56_2'
  | 'huntG56_3'
  | 'huntG56_4'
  | 'huntG56_5';

/** 틀린그림 찾기의 그림 한 장과 그 안의 이상한 곳 */
export interface ErrorHuntPuzzle {
  id: string;
  /** 그림 이름(교실, 운동장 등) */
  title: string;
  imageKey: ErrorHuntImageKey;
  regions: CircleRegion[];
}

export interface ErrorHuntConfig {
  type: 'error_hunt';
  /** 학년 공통 그림 한 장. 그림 묶음이 없는 학년이 쓴다. */
  imageKey: ErrorHuntImageKey;
  instruction: string;
  regions: CircleRegion[];
  /**
   * 학년별 그림 묶음. 적어 둔 학년은 이 그림을 차례로 푼다.
   * 없으면 프로그램에 든 기본 묶음(DEFAULT_ERROR_HUNT_PUZZLES)을 쓴다.
   */
  gradePuzzles?: Partial<Record<Grade, ErrorHuntPuzzle[]>>;
}

/** 그리기 미션의 학년군. 같은 학년군은 같은 명화 후보를 쓴다. */
export type DrawingGradeBand = 'grade34' | 'grade56';

/** 교사 화면에 띄우는 원작 명화 이미지(asset manifest의 키) */
export type ArtworkImageKey =
  'artworkStarryNight' | 'artworkGleaners' | 'artworkSsireum' | 'artworkGrandeJatte';

/** 명화를 AI 시대의 모습으로 재해석한 그림 프롬프트 */
export interface DrawingPrompt {
  id: string;
  gradeBand: DrawingGradeBand;
  /** 학년군 안에서의 번호(①, ②) */
  optionNo: number;
  artist: string;
  artwork: string;
  /** 감상할 때 함께 확인할 화가의 표현 기법 */
  technique: string;
  /** 학생에게 보여 주는 그림 프롬프트 */
  text: string;
  /** 원작 이미지가 없으면 제목만 보여 준다. */
  imageKey: ArtworkImageKey | null;
}

export interface DrawingConfig {
  type: 'drawing';
  prompts: DrawingPrompt[];
  /** 학년별로 고른 프롬프트 ID. 같은 학년은 모든 라운드에서 같은 프롬프트로 그린다. */
  selectedPromptIds: Partial<Record<Grade, string>>;
}

export interface OzobotConfig {
  type: 'ozobot';
  rules: string[];
  /** 제한 시간(분). 없으면 7분. 다른 부스의 게임 시간과 따로 정한다. */
  timeLimitMinutes?: number;
}

/**
 * 도서관 오류찾기의 정답. 학생 답에 인정하는 말이 들어 있으면 그 항목을 맞은 것으로 본다.
 * 골든벨 문제처럼 미션 설정에 들어가므로 실제 정답은 행사 사이트에서 교사가 등록한다.
 */
export interface LibraryCheckAnswerKey {
  /** 틀린 부분으로 인정하는 말(하나라도 들어 있으면 정답) */
  wrongPartKeywords: string[];
  /** 올바른 내용으로 인정하는 말 */
  correctionKeywords: string[];
  /** 확인할 수 있는 책 제목(부제가 붙어도 인정) */
  bookTitles: string[];
  /** 인정하는 쪽수 범위. pageTo가 없으면 pageFrom 한 쪽만 */
  pageFrom: number | null;
  pageTo: number | null;
}

export interface LibraryCheckConfig {
  type: 'library_check';
  passageTitle: string;
  passage: string;
  /** 정답을 등록하면 제출 즉시 자동으로 채점한다. 없으면 선생님이 직접 채점한다. */
  answerKey?: LibraryCheckAnswerKey;
}

export type MissionConfig =
  GoldenBellConfig | ErrorHuntConfig | DrawingConfig | OzobotConfig | LibraryCheckConfig;

export interface Mission {
  id: string;
  no: MissionNo;
  type: MissionType;
  title: string;
  room: string;
  cardType: CardType;
  summary: string;
  /** 교사가 결과를 확인해 판정하는 미션인지 */
  teacherJudged: boolean;
  enabled: boolean;
  config: MissionConfig;
}

export interface GoldenBellAnswer {
  type: 'golden_bell';
  /** 문제 ID → 고른 보기 번호(0부터) */
  selections: Record<string, number>;
  /** 단답형: 문제 ID → 학생이 적은 답 */
  texts?: Record<string, string>;
}

export interface ErrorHuntAnswer {
  type: 'error_hunt';
  foundRegionIds: string[];
  wrongTaps: number;
  remainingSeconds: number;
}

/** 그림 제출 요약. 종이 그림을 찍은 사진 파일은 drawingSubmissions 문서에 따로 저장한다. */
export interface DrawingAnswer {
  type: 'drawing';
  /** 학생이 보고 그린 프롬프트. 예전 화면 그림판 제출에는 없다. */
  promptId: string | null;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
}

/** 선생님이 오조봇으로 확인한 성공 한 건 */
export interface OzobotSolve {
  /** 도전 과제 카드 ID(src/domain/ozobot.ts) */
  challengeId: string;
  /** 별 수. 점수는 별 1개 5점, 2개 10점, 3개 20점 */
  level: 1 | 2 | 3;
  /** 선생님이 성공을 기록한 시각(epoch ms) */
  at: number;
}

/**
 * 로봇 길찾기 기록. 학생은 쓰지 않고 선생님이 성공을 기록한다.
 * 예전에는 학생이 "시작 준비 완료"만 알렸다(ready).
 */
export interface OzobotAnswer {
  type: 'ozobot';
  solved?: OzobotSolve[];
  ready?: true;
}

export interface LibraryCheckAnswer {
  type: 'library_check';
  wrongPart: string;
  correction: string;
  bookTitle: string;
  page: number;
}

export type SubmissionAnswer =
  GoldenBellAnswer | ErrorHuntAnswer | DrawingAnswer | OzobotAnswer | LibraryCheckAnswer;

export type SubmissionStatus = 'draft' | 'submitted' | 'verified';

export interface Submission {
  /** 미션·팀별 고정 ID: `${missionId}__${teamId}` */
  id: string;
  teamId: string;
  classId: string;
  missionId: string;
  grade: Grade;
  roundNo: RoundNo;
  status: SubmissionStatus;
  answer: SubmissionAnswer;
  score: number | null;
  /** 교사가 제출을 되돌려 다시 낼 수 있게 한 상태(status는 draft) */
  reopened: boolean;
  submittedAt: number | null;
  updatedAt: number;
}

/** 교사가 내려받는 그림 파일 */
export interface DrawingFile {
  teamId: string;
  missionId: string;
  promptId: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  bytes: Uint8Array;
  submittedAt: number | null;
}

export interface MissionResult {
  id: string;
  missionId: string;
  grade: Grade;
  roundNo: RoundNo;
  teamId: string;
  score: number;
  rank: number;
  finalizedBy: string;
  finalizedAt: number;
}

/** 순위에 따른 카드 종류 결정 방식: 1위 3종 중 선택, 2위 2종 중 선택, 3위 이하 자동 배정 */
export type CardSelectionMode = 'choose_three' | 'choose_two' | 'automatic';
export type CardAwardStatus = 'pending' | 'claimed';

/**
 * 카드 보상 원장. 순위 결과 하나당 하나이며 ID는 결과 ID와 같다.
 * 학급 카드 진행도는 claimed 보상의 selectedType만 세어 계산한다.
 */
export interface CardAward {
  id: string;
  resultId: string;
  grade: Grade;
  classId: string;
  teamId: string;
  missionId: string;
  roundNo: RoundNo;
  rank: number;
  selectionMode: CardSelectionMode;
  /** 서로 다른 후보 종류. 자동 배정이면 1개 */
  offeredTypes: CardType[];
  selectedType: CardType | null;
  status: CardAwardStatus;
  createdAt: number;
  claimedAt: number | null;
}

/** 조각 수: 0/4 ~ 4/4 */
export type CardPieceCount = 0 | 1 | 2 | 3 | 4;

/** 학급 카드 한 종류의 성장 상태 */
export interface CardProgress {
  cardType: CardType;
  /** 이 종류를 받은 전체 횟수 */
  earned: number;
  pieces: CardPieceCount;
  /** 4조각을 넘어 받은 중복 수(+N) */
  duplicates: number;
  complete: boolean;
}

/** 학급 카드 5종의 네 조각 진행도 */
export interface ClassCardProgress {
  classId: string;
  cards: Record<CardType, CardProgress>;
  completedCount: number;
  allComplete: boolean;
}

/**
 * 총괄 운영자와 교사. 교사는 모든 부스를 운영하고 모든 학급의 최종 미션을 진행할 수 있다.
 * 행사 전체에 영향을 주는 일(라운드 제어, 최종 미션 열기·결과 공개, 행사 설정, 교사 등록)은 총괄만 한다.
 * 예전에는 부스 교사와 담임교사를 담당별로 나눴다(2026-09-28에 합침).
 */
export type TeacherRole = 'admin' | 'teacher';

export interface TeacherProfile {
  uid: string;
  displayName: string;
  role: TeacherRole;
}

/**
 * 총괄 운영자가 이메일로 미리 등록한 교사. ID는 소문자 이메일이다.
 * 그 Google 계정으로 처음 로그인하면 같은 역할의 교사 문서(teachers/{uid})가 만들어진다.
 */
export interface TeacherInvite {
  email: string;
  /** 비어 있으면 첫 로그인 때 Google 계정 이름을 쓴다. */
  displayName: string;
  role: TeacherRole;
  createdAt: number | null;
}

/** 등록된 교사 계정(teachers/{uid}). 총괄 운영자만 목록을 본다. */
export interface TeacherAccount {
  uid: string;
  displayName: string;
  email: string;
  role: TeacherRole;
  active: boolean;
}

// ---- 팀 이동과 QR 체크인 ----

export type TeamMissionStatus =
  'scheduled' | 'checked_in' | 'active' | 'completed' | 'moving' | 'attention';

export type AlertCode =
  'not_arrived' | 'wrong_station' | 'result_missing' | 'duplicate_scan' | 'manual_review';

/** 팀의 라운드별 위치·상태 원본. ID는 `${classId}_${teamNo}_${roundNo}`로 고정이다. */
export interface TeamMissionState {
  id: string;
  grade: Grade;
  classId: string;
  teamId: string;
  teamNo: TeamNo;
  roundNo: RoundNo;
  expectedMissionId: string;
  /** 체크인한 미션. 예정과 다른 교실 QR을 찍었으면 그 미션 ID가 남는다. */
  actualMissionId: string | null;
  /** 저장된 경고와 시각으로 계산한 경고를 합친 화면 표시용 상태 */
  status: TeamMissionStatus;
  alertCodes: AlertCode[];
  checkedInAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  resultId: string | null;
  updatedAt: number;
}

/**
 * 부스 라운드의 단계. 선생님이 자기 부스에서 차례로 진행한다.
 * ready(열기 전) → open(라운드를 열어 팀이 들어오는 중) → active(게임 중)
 * → scoring(게임 시간이 끝나 순위를 매기는 중) → completed(라운드 종료, 팀은 다음 교실로 이동)
 */
export type MissionRoundStatus = 'ready' | 'open' | 'active' | 'scoring' | 'completed';

/** 부스(미션 교실)의 라운드별 상태. ID는 `${missionId}_g${grade}_r${roundNo}` */
export interface MissionRoundState {
  id: string;
  grade: Grade;
  missionId: string;
  roundNo: RoundNo;
  /** 시각으로 계산한 단계. 게임 시간이 끝나면 저절로 scoring이 된다. */
  status: MissionRoundStatus;
  openedAt: number | null;
  /** 게임을 시작한 시각 */
  startedAt: number | null;
  /** 게임이 끝나는 시각(시작 시각 + 게임 시간) */
  endsAt: number | null;
  /** 라운드를 종료한 시각 */
  completedAt: number | null;
  resultFinalizedAt: number | null;
  /** 게임과 순위 없이 건너뛴 라운드인지 */
  skipped: boolean;
  updatedBy: string | null;
}

export type ActivityType =
  | 'check_in'
  | 'wrong_station'
  | 'mission_started'
  | 'result_finalized'
  | 'card_earned'
  | 'card_completed'
  | 'round_changed'
  | 'alert'
  | 'final_opened'
  | 'final_started'
  | 'final_submitted'
  | 'results_published'
  | 'manual_fix';

/** 중요한 상태 변경만 남기는 활동 기록. 같은 원인은 같은 ID라 한 번만 저장된다. */
export interface ActivityEvent {
  id: string;
  grade: Grade;
  type: ActivityType;
  message: string;
  classId: string | null;
  teamId: string | null;
  missionId: string | null;
  roundNo: RoundNo | null;
  at: number;
}

// ---- 학급 전체 최종 미션 ----

export type FinalSessionStatus =
  'locked' | 'open' | 'results_hidden' | 'results_published' | 'closed';

/** 학년별 최종 미션 세션. 총괄 운영자가 연 뒤에 각 반이 따로 시작한다. */
export interface FinalSession {
  grade: Grade;
  status: FinalSessionStatus;
  questionCount: number;
  durationLimitSec: number;
  openedAt: number | null;
  openedBy: string | null;
  /** 개방 조건을 채우지 못한 채 강제로 열었을 때의 사유 */
  forceOpenReason: string | null;
  resultsPublishedAt: number | null;
}

export type FinalClassStatus =
  'locked' | 'ready' | 'active' | 'submitted' | 'timeout' | 'review_required';

/** 학급 최종 미션 상태, 점수, 시작·제출 시각의 원본 */
export interface FinalClassState {
  classId: string;
  grade: Grade;
  status: FinalClassStatus;
  currentQuestionIndex: number;
  /** 시작할 때 고정한 완성 카드 종류 수 */
  completedCardTypeCountSnapshot: number;
  /** 시작할 때 고정한 5종 완성 여부(순위 두 번째 기준) */
  allFiveCardsCompletedSnapshot: boolean;
  hintTotal: number;
  hintUsed: number;
  startedAt: number | null;
  submittedAt: number | null;
  durationMs: number | null;
  /** 결과 공개 전에는 총괄 운영자에게만 값을 보낸다. */
  correctCount: number | null;
  finalRank: number | null;
  manualOverride: boolean;
  overrideReason: string | null;
  overrideBy: string | null;
  updatedAt: number;
}

/** 문제별 응답. ID는 `${classId}_${questionId}` */
export interface FinalResponse {
  id: string;
  classId: string;
  grade: Grade;
  questionId: string;
  selectedChoiceId: string | null;
  hintUsed: boolean;
  removedChoiceId: string | null;
  confirmedAt: number | null;
  updatedAt: number;
}

export interface FinalChoice {
  id: string;
  label: string;
}

/** 문제와 함께 전자칠판에 띄우는 그림. src는 data URL이거나 앱 안의 경로다. */
export interface FinalQuestionImage {
  src: string;
  /** 한국어 대체 텍스트. 정답을 드러내면 안 된다. */
  alt: string;
}

/** 화면에 보내는 문제. 정답과 힌트 제거 대상은 들어 있지 않다. */
export interface FinalQuestion {
  id: string;
  /** 문제 영역(생각·관찰·표현·명령·검증) */
  area: CardType;
  /** 화면 배지에 쓰는 문제 유형 이름(예: "넌센스"). 없으면 영역 이름을 쓴다. */
  category: string | null;
  text: string;
  /** 함께 보여 줄 자료 글. 없으면 null */
  passage: string | null;
  /** 함께 보여 줄 그림. 보기 번호가 그림 안에 있으면 보기 순서를 섞으면 안 된다. */
  image: FinalQuestionImage | null;
  choices: FinalChoice[];
}

/** 문제 하나의 설정. 정답과 힌트로 지울 오답은 저장소 안에서만 쓴다. */
export interface FinalQuestionConfig {
  question: FinalQuestion;
  answerChoiceId: string;
  /** 힌트를 쓰면 지울 오답 보기. 정답이면 안 된다. */
  hintRemoveChoiceId: string;
  /** 교사용 해설. 정답과 함께 총괄 운영자만 읽는다. */
  explanation: string | null;
}

/** 문제 묶음의 출처. 샘플은 행사 구조를 만들 때 자동으로 들어간 것이다. */
export type FinalQuestionSource = 'sample' | 'upload';

/** 학년별 최종 미션 문제 묶음. 같은 학년의 모든 학급이 같은 문제를 푼다. */
export interface FinalQuestionSet {
  grade: Grade;
  questions: FinalQuestionConfig[];
  source: FinalQuestionSource;
  /** 마지막으로 넣거나 바꾼 시각. 모르면 null */
  updatedAt: number | null;
}
