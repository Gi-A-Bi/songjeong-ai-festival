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

export interface FestivalEvent {
  id: string;
  title: string;
  schoolName: string;
  status: EventStatus;
  activeGrade: Grade | null;
  /** 0이면 아직 라운드를 시작하지 않은 상태 */
  activeRound: 0 | RoundNo;
  /** 진행 중인 라운드의 종료 시각(epoch ms) */
  roundEndsAt: number | null;
  /** 일시정지 중일 때 남아 있던 시간(ms) */
  pausedRemainingMs: number | null;
  /** 지금 라운드를 종료한 시각(epoch ms). 이동 시간 타이머의 기준이며 다음 라운드를 시작하면 null */
  roundEndedAt: number | null;
  roundDurationMs: number;
  moveDurationMs: number;
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

export interface GoldenBellQuestion {
  /** 문제를 고쳐도 학생 답이 따라가도록 고정한 ID */
  id: string;
  question: string;
  choices: string[];
  /** 정답 보기 번호(0부터) */
  answerIndex: number;
  explanation: string;
}

/** 골든벨 문제 목록. 교사가 미션 운영 화면에서 등록한다. */
export interface GoldenBellConfig {
  type: 'golden_bell';
  questions: GoldenBellQuestion[];
}

/** 정답 영역. 좌표와 반지름은 이미지 너비·높이에 대한 0~1 비율이다. */
export interface CircleRegion {
  id: string;
  x: number;
  y: number;
  /** 이미지 너비에 대한 반지름 비율 */
  r: number;
  label: string;
}

export interface ErrorHuntConfig {
  type: 'error_hunt';
  imageKey: 'missionErrorHunt';
  instruction: string;
  regions: CircleRegion[];
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
}

export interface LibraryCheckConfig {
  type: 'library_check';
  passageTitle: string;
  passage: string;
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

export interface OzobotAnswer {
  type: 'ozobot';
  ready: true;
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

/** 총괄 운영자, 부스 교사, 담임교사(CARD_FINALE_UPDATE_SPEC 3장) */
export type TeacherRole = 'admin' | 'station_teacher' | 'homeroom_teacher';

export interface TeacherProfile {
  uid: string;
  displayName: string;
  role: TeacherRole;
  /** 부스 교사의 담당 미션. null이면 담당이 정해지지 않아 모든 부스를 운영할 수 있다. */
  missionId: string | null;
  /** 담임교사의 담당 학급 */
  classId: string | null;
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

export type MissionRoundStatus = 'ready' | 'active' | 'scoring' | 'completed';

/** 부스(미션 교실)의 라운드별 상태. ID는 `${missionId}_g${grade}_r${roundNo}` */
export interface MissionRoundState {
  id: string;
  grade: Grade;
  missionId: string;
  roundNo: RoundNo;
  status: MissionRoundStatus;
  startedAt: number | null;
  completedAt: number | null;
  resultFinalizedAt: number | null;
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
