/** 행사 도메인 타입. 저장소 구현(mock, firebase)과 화면이 함께 사용한다. */

export type Grade = 3 | 4 | 5 | 6;
export type TeamNo = 1 | 2 | 3 | 4 | 5;
export type MissionNo = 1 | 2 | 3 | 4 | 5;
export type RoundNo = 1 | 2 | 3 | 4 | 5;

export type EventStatus = 'draft' | 'ready' | 'active' | 'paused' | 'exchange' | 'completed';
export type RoundStatus = 'waiting' | 'active' | 'scoring' | 'closed';
export type ClassStatus = 'ready' | 'touring' | 'exchange' | 'complete';
export type TeamStatus = 'ready' | 'active' | 'finished';

export type MissionType = 'golden_bell' | 'error_hunt' | 'drawing' | 'ozobot' | 'library_check';
export type CardType = 'thinking' | 'observation' | 'expression' | 'command' | 'verification';

/** 미션 공통 셸에서 보여 주는 팀 기준 미션 상태 */
export type MissionPhase = 'waiting' | 'active' | 'submitted' | 'scoring' | 'closed';

export type CardCounts = Record<CardType, number>;

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

export interface DrawingConfig {
  type: 'drawing';
  promptId: string;
  prompt: string;
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

/** 그림 제출 요약. 그림 파일은 drawingSubmissions 문서에 따로 저장한다. */
export interface DrawingAnswer {
  type: 'drawing';
  strokeCount: number;
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

export interface DrawTicket {
  id: string;
  teamId: string;
  classId: string;
  sourceResultId: string;
  cardType: CardType;
  claimedAt: number | null;
  /** 교사가 순위를 고쳐 회수한 뽑기권. 기록은 지우지 않고 표시만 한다. */
  revokedAt: number | null;
  createdAt: number;
}

export interface Exchange {
  id: string;
  requestId: string;
  fromClassId: string;
  toClassId: string;
  cardType: CardType;
  quantity: number;
  status: 'completed' | 'reversed';
  createdBy: string;
  createdAt: number;
  reversesExchangeId: string | null;
}

export interface TeacherProfile {
  uid: string;
  displayName: string;
  role: 'teacher' | 'admin';
}
