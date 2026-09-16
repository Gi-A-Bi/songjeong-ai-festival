import type {
  CardCounts,
  CardType,
  ClassInfo,
  DrawingFile,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
  MissionConfig,
  MissionResult,
  RoundNo,
  RoundStatus,
  Submission,
  SubmissionAnswer,
  Team,
  TeacherProfile,
} from '../domain/types';

export type DataMode = 'mock' | 'firebase';
export type Unsubscribe = () => void;

export interface TeamSession {
  eventId: string;
  teamId: string;
  joinedAt: number;
}

/** 학생에게 보이는 뽑기권. 카드 종류는 사용한 뒤에만 공개된다. */
export interface TicketView {
  id: string;
  claimed: boolean;
  cardType: CardType | null;
  sourceLabel: string;
}

export interface TeamCardSummary {
  team: CardCounts;
  class: CardCounts;
  classDisplayName: string;
}

export interface ClassCardRow {
  classInfo: ClassInfo;
  counts: CardCounts;
}

/** 학생 미션 화면에 필요한 정보 묶음 */
export interface TeamMissionView {
  team: Team;
  mission: Mission;
  roundNo: RoundNo;
  roundStatus: RoundStatus;
  submission: Submission | null;
  finalized: boolean;
  answerRevealed: boolean;
}

/**
 * 학생 미션 화면이 실시간으로 지켜보는 작은 상태 문서.
 * 교사가 정답 공개, 순위 확정·수정, 재제출 허용을 하면 updatedAt이 바뀐다.
 */
export interface MissionLiveState {
  answerRevealed: boolean;
  finalized: boolean;
  updatedAt: number;
}

/** 교사 미션 운영 화면의 참가 팀 한 줄. submission.score는 자동 점수까지 채운 값이다. */
export interface MissionParticipant {
  team: Team;
  submission: Submission | null;
  result: MissionResult | null;
  /** 회수되지 않은 뽑기권 수 */
  ticketCount: number;
  /** 그중 이미 카드를 뽑은 수 */
  claimedTicketCount: number;
}

export interface MissionProgress {
  missionId: string;
  submitted: number;
  total: number;
  finalized: boolean;
}

/** 그림 미션 제출 때 함께 보내는 그림 파일 */
export interface DrawingUpload {
  promptId: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface SaveSubmissionInput {
  eventId: string;
  missionId: string;
  teamId: string;
  answer: SubmissionAnswer;
  requestId: string;
  /** 그림 미션일 때만 */
  drawing?: DrawingUpload;
}

export interface ReopenSubmissionInput {
  eventId: string;
  missionId: string;
  teamId: string;
}

export interface RankingEntryInput {
  teamId: string;
  score: number;
  rank: number;
}

export interface FinalizeRankingInput {
  eventId: string;
  missionId: string;
  grade: Grade;
  roundNo: RoundNo;
  entries: RankingEntryInput[];
  requestId: string;
}

export interface FinalizeRankingOutcome {
  results: MissionResult[];
  ticketsByTeam: Record<string, number>;
  alreadyFinalized: boolean;
}

export interface ReviseRankingOutcome {
  results: MissionResult[];
  /** 수정 뒤 팀별 뽑기권 수 */
  ticketsByTeam: Record<string, number>;
  added: number;
  revoked: number;
  /** 회수한 뽑기권 중 이미 카드를 뽑았던 수 */
  revokedClaimed: number;
}

export interface CreateExchangeInput {
  eventId: string;
  requestId: string;
  fromClassId: string;
  toClassId: string;
  cardType: CardType;
  quantity: number;
}

export type RoundControlAction = 'start' | 'pause' | 'end';

export interface EventSetupSummary {
  /** 이번 호출로 새로 만들었으면 true, 이미 있으면 false */
  created: boolean;
  classes: number;
  teams: number;
  missions: number;
}

/**
 * 화면과 데이터 저장소 사이의 경계.
 * 1단계는 MockEventRepository, 2단계부터 FirestoreEventRepository가 구현한다.
 */
export interface EventRepository {
  readonly mode: DataMode;

  // 행사 준비
  /** 행사·학급·팀·미션 기본 구조를 만든다. 이미 있으면 덮어쓰지 않는다. */
  setupEvent(eventId: string): Promise<EventSetupSummary>;

  // 행사 상태
  getEvent(eventId: string): Promise<FestivalEvent>;
  subscribeEvent(
    eventId: string,
    onChange: (event: FestivalEvent) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  controlRound(eventId: string, action: RoundControlAction): Promise<FestivalEvent>;
  setActiveGrade(eventId: string, grade: Grade): Promise<FestivalEvent>;
  getRoundStatus(eventId: string, grade: Grade, roundNo: RoundNo): Promise<RoundStatus>;

  // 미션·학급·팀
  listMissions(eventId: string): Promise<Mission[]>;
  getMission(eventId: string, missionId: string): Promise<Mission>;
  listClasses(eventId: string, grade: Grade): Promise<ClassInfo[]>;
  listTeams(eventId: string, grade: Grade): Promise<Team[]>;
  getTeam(eventId: string, teamId: string): Promise<Team>;
  joinTeam(eventId: string, teamId: string): Promise<TeamSession>;

  // 제출
  getTeamMissionView(eventId: string, teamId: string, missionId: string): Promise<TeamMissionView>;
  subscribeMissionState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (state: MissionLiveState) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  listTeamSubmissions(eventId: string, teamId: string): Promise<Submission[]>;
  /** 지금 진행 중인 라운드의 미션이거나 교사가 재제출을 허용했을 때만 받는다. */
  saveSubmission(input: SaveSubmissionInput): Promise<Submission>;
  getRoundProgress(eventId: string, grade: Grade, roundNo: RoundNo): Promise<MissionProgress[]>;

  // 교사 운영
  listMissionParticipants(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionParticipant[]>;
  setAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    revealed: boolean,
  ): Promise<void>;
  isAnswerRevealed(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<boolean>;
  finalizeRanking(input: FinalizeRankingInput): Promise<FinalizeRankingOutcome>;
  /** 확정한 순위를 고치고 뽑기권 수를 맞춘다(모자라면 발급, 남으면 회수 표시). */
  reviseRanking(input: FinalizeRankingInput): Promise<ReviseRankingOutcome>;
  /** 순위 확정 전 제출을 되돌려 팀이 다시 낼 수 있게 한다. */
  reopenSubmission(input: ReopenSubmissionInput): Promise<void>;
  /** 미션 문제 같은 설정을 바꾼다. 미션 종류는 바꿀 수 없다. */
  updateMissionConfig(eventId: string, missionId: string, config: MissionConfig): Promise<Mission>;
  /** 교사가 열 때만 그림 파일을 읽는다(실시간 구독하지 않음). */
  listDrawingFiles(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<DrawingFile[]>;

  // 카드
  listTeamTickets(eventId: string, teamId: string): Promise<TicketView[]>;
  claimTicket(eventId: string, teamId: string, ticketId: string): Promise<CardType>;
  getTeamCardSummary(eventId: string, teamId: string): Promise<TeamCardSummary>;
  listClassCardRows(eventId: string, grade: Grade): Promise<ClassCardRow[]>;
  listExchanges(eventId: string, grade: Grade): Promise<Exchange[]>;
  createExchange(input: CreateExchangeInput): Promise<Exchange>;

  // 교사 인증
  getCurrentTeacher(): TeacherProfile | null;
  /** 새로고침 뒤 남아 있는 로그인으로 교사 자격을 다시 확인한다. */
  restoreTeacher(): Promise<TeacherProfile | null>;
  signInTeacher(): Promise<TeacherProfile>;
  signOutTeacher(): Promise<void>;
}

/** 개발·리허설용 조작. mock 저장소에서만 제공한다. */
export interface DevTools {
  failNextRequest(): void;
  resetData(): void;
}
