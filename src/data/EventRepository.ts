import type {
  CardCounts,
  CardType,
  ClassInfo,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
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

/** 교사 미션 운영 화면의 참가 팀 한 줄 */
export interface MissionParticipant {
  team: Team;
  submission: Submission | null;
  result: MissionResult | null;
  ticketCount: number;
}

export interface MissionProgress {
  missionId: string;
  submitted: number;
  total: number;
  finalized: boolean;
}

export interface SaveSubmissionInput {
  eventId: string;
  missionId: string;
  teamId: string;
  answer: SubmissionAnswer;
  requestId: string;
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

export interface CreateExchangeInput {
  eventId: string;
  requestId: string;
  fromClassId: string;
  toClassId: string;
  cardType: CardType;
  quantity: number;
}

export type RoundControlAction = 'start' | 'pause' | 'end';

/**
 * 화면과 데이터 저장소 사이의 경계.
 * 1단계는 MockEventRepository, 2단계부터 FirestoreEventRepository가 구현한다.
 */
export interface EventRepository {
  readonly mode: DataMode;

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
  listTeamSubmissions(eventId: string, teamId: string): Promise<Submission[]>;
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
