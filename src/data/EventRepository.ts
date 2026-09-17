import type { RoundPhase } from '../domain/tour';
import type {
  ActivityEvent,
  AlertCode,
  CardAward,
  CardProgress,
  CardType,
  ClassCardProgress,
  ClassInfo,
  DrawingFile,
  FestivalEvent,
  FinalClassState,
  FinalClassStatus,
  FinalQuestion,
  FinalResponse,
  FinalSession,
  Grade,
  Mission,
  MissionConfig,
  MissionResult,
  MissionRoundState,
  RoundNo,
  RoundStatus,
  Submission,
  SubmissionAnswer,
  Team,
  TeacherProfile,
  TeacherRole,
  TeamMissionState,
} from '../domain/types';

export type DataMode = 'mock' | 'firebase';

export interface RepositoryCapabilities {
  /** QR 체크인, 팀 이동 상태, 실시간 운영 대시보드 */
  liveOps: boolean;
  /** 학급 전체 최종 미션 */
  classFinal: boolean;
}
export type Unsubscribe = () => void;

export interface TeamSession {
  eventId: string;
  teamId: string;
  joinedAt: number;
}

/** 팀에 입장한 기기(익명 세션). 학생 이름이나 계정 정보는 없다. */
export interface TeamDevice {
  id: string;
  teamId: string;
  /** 학생 화면에도 보이는 짧은 기기 번호. 교사가 어느 기기인지 확인할 때 쓴다. */
  code: string;
  joinedAt: number | null;
  lastSeenAt: number | null;
}

/** 이 기기의 번호와 지금 묶여 있는 팀 */
export interface DeviceInfo {
  code: string;
  team: Team | null;
}

/** 화면에 보여 줄 카드 보상. sourceLabel은 “2라운드 AI 골든벨 1위” 같은 출처 문구다. */
export interface CardAwardView extends CardAward {
  sourceLabel: string;
}

/** 팀의 카드 보상과 학급 카드 진행도(보상 선택 화면·카드 현황 화면) */
export interface TeamRewardView {
  classInfo: ClassInfo;
  progress: ClassCardProgress;
  /** 이 팀의 보상. 고르기 전 보상이 앞, 그다음 최근 순 */
  awards: CardAwardView[];
}

export interface ClaimCardAwardInput {
  eventId: string;
  teamId: string;
  awardId: string;
  selectedType: CardType;
  requestId: string;
}

export interface ClaimCardAwardOutcome {
  award: CardAwardView;
  /** 받기 전·후 해당 카드 진행도. 이미 처리한 요청을 다시 보내면 둘이 같을 수 있다. */
  before: CardProgress;
  after: CardProgress;
  progress: ClassCardProgress;
}

export interface ClassCardBoard {
  classInfo: ClassInfo;
  progress: ClassCardProgress;
}

/** 교사용 학급 카드 화면: 진행도와 카드 보상 원장 */
export interface TeacherClassCards {
  classInfo: ClassInfo;
  teams: Team[];
  progress: ClassCardProgress;
  awards: CardAwardView[];
}

// ---- 팀 이동과 QR 체크인 ----

export interface CheckInInput {
  eventId: string;
  teamId: string;
  /** 미션 교실 QR이 가리키는 미션 ID */
  stationId: string;
}

export interface CheckInOutcome {
  kind: 'checked_in' | 'already_checked_in' | 'wrong_station';
  roundNo: RoundNo;
  /** QR을 찍은 교실 */
  scannedMission: Mission;
  /** 이번 라운드에 가야 할 교실 */
  expectedMission: Mission;
  state: TeamMissionState;
}

/** 팀 홈에 보여 줄 이동 상태. 투어 중이 아니면 roundNo가 null */
export interface TeamTourStatus {
  roundNo: RoundNo | null;
  state: TeamMissionState | null;
  expectedMission: Mission | null;
  nextMission: Mission | null;
}

// ---- 실시간 운영 대시보드 ----

export interface OpsTeamCell {
  team: Team;
  mission: Mission;
  state: TeamMissionState;
}

export interface OpsStation {
  mission: Mission;
  round: MissionRoundState;
  /** 이번 라운드에 이 교실로 올 예정인 팀(학급당 한 팀) */
  teams: OpsTeamCell[];
  submitted: number;
}

export interface OpsClassRow {
  classInfo: ClassInfo;
  /** 1~5팀 순서 */
  cells: OpsTeamCell[];
}

export interface OpsAlert {
  id: string;
  code: AlertCode;
  team: Team;
  mission: Mission;
  roundNo: RoundNo;
  message: string;
}

export interface OpsSummary {
  grade: Grade;
  roundNo: 0 | RoundNo;
  phase: RoundPhase;
  expectedTeams: number;
  checkedInTeams: number;
  completedTeams: number;
  alertCount: number;
}

/** 현재 학년·현재 라운드의 운영 상황판 */
export interface OpsDashboard {
  summary: OpsSummary;
  stations: OpsStation[];
  classRows: OpsClassRow[];
  alerts: OpsAlert[];
  /** 최근 활동(최신 순) */
  activity: ActivityEvent[];
}

export interface ClassOpsTeam {
  team: Team;
  currentMission: Mission | null;
  nextMission: Mission | null;
  state: TeamMissionState | null;
  completedCount: number;
  results: { roundNo: RoundNo; mission: Mission; rank: number | null }[];
  earnedTypes: CardType[];
}

/** 학급 상세: 팀별 위치·순위·카드와 최종 미션 준비 상태 */
export interface ClassOpsDetail {
  classInfo: ClassInfo;
  teams: ClassOpsTeam[];
  progress: ClassCardProgress;
  /** 지금 최종 미션을 시작하면 받을 힌트 수 */
  hintPreview: number;
  session: FinalSession;
  finalState: FinalClassState;
  finalStatus: FinalClassStatus;
  /** 이 교사가 이 학급의 최종 미션을 시작·진행할 수 있는지 */
  canRunFinal: boolean;
  /** 지금 시작할 수 없는 이유. 시작할 수 있으면 null */
  startBlocker: string | null;
}

export interface StartStationInput {
  eventId: string;
  missionId: string;
  grade: Grade;
  roundNo: RoundNo;
}

export interface MarkArrivedInput {
  eventId: string;
  teamId: string;
  missionId: string;
  roundNo: RoundNo;
}

/** 부스 화면의 입장 현황. 팀이 QR을 찍을 때마다 이것만 다시 읽는다(채점 자료는 다시 읽지 않는다). */
export interface StationArrivals {
  booth: MissionRoundState;
  /** 이번 라운드에 이 교실로 올 팀의 상태(학급 순서) */
  movements: TeamMissionState[];
}

// ---- 학급 전체 최종 미션 ----

export interface FinalOpenChecklist {
  roundsClosed: boolean;
  missingResults: number;
  pendingAwards: number;
  /** 열지 못하는 이유. 비어 있으면 바로 열 수 있다. */
  blockers: string[];
}

export interface FinalBoardRow {
  classInfo: ClassInfo;
  /** 결과 공개 전에는 총괄 운영자가 아니면 정답 수와 순위가 비어 있다. */
  state: FinalClassState;
  status: FinalClassStatus;
  confirmedCount: number;
  hintLeft: number;
}

/** 학년 최종 미션 현황과 결과 */
export interface FinalBoard {
  session: FinalSession;
  checklist: FinalOpenChecklist;
  rows: FinalBoardRow[];
  canViewResults: boolean;
  /** 모든 학급이 제출(또는 시간 마감)했는지 */
  allFinished: boolean;
}

/** 전자칠판용 학급 최종 미션 화면 */
export interface ClassFinalView {
  classInfo: ClassInfo;
  session: FinalSession;
  state: FinalClassState;
  status: FinalClassStatus;
  /** 진행 중일 때 현재 문제. 정답과 힌트 제거 대상은 들어 있지 않다. */
  question: FinalQuestion | null;
  response: FinalResponse | null;
  confirmedCount: number;
  canViewResults: boolean;
  canRunFinal: boolean;
}

export interface OpenFinalInput {
  eventId: string;
  grade: Grade;
  /** 개방 조건을 채우지 못해도 연다. 사유를 꼭 적어야 한다. */
  force: boolean;
  reason: string;
}

export interface StartClassFinalInput {
  eventId: string;
  classId: string;
  requestId: string;
}

export interface SelectFinalChoiceInput {
  eventId: string;
  classId: string;
  questionId: string;
  choiceId: string;
}

export interface FinalQuestionActionInput {
  eventId: string;
  classId: string;
  questionId: string;
  requestId: string;
}

export interface AdjustFinalResultInput {
  eventId: string;
  classId: string;
  /** null이면 바꾸지 않는다. */
  correctCount: number | null;
  durationMs: number | null;
  /** 직접 정할 순위. null이면 자동 순위 */
  finalRank: number | null;
  reason: string;
}

export interface FinalAdminActionInput {
  eventId: string;
  classId: string;
  reason: string;
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
  /** 순위 확정 뒤 만들어진 카드 보상 */
  award: CardAward | null;
  /** 이 라운드의 체크인·진행 상태 */
  movement: TeamMissionState;
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
  /** 결과 하나당 하나씩 만든 카드 보상 */
  awards: CardAward[];
  alreadyFinalized: boolean;
}

export interface ReviseRankingOutcome {
  results: MissionResult[];
  awards: CardAward[];
  /** 고르기 전이라 새 순위에 맞춰 후보를 다시 정한 보상 수 */
  reoffered: number;
  /** 이미 받은 뒤라 순위가 바뀌어도 그대로 둔 보상 수 */
  keptClaimed: number;
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
  /** 아직 연결하지 않은 기능은 화면에서 숨긴다. */
  readonly capabilities: RepositoryCapabilities;

  /** 서버 기준 현재 시각 추정값(epoch ms). 화면의 남은 시간·잠금 계산은 이 값을 쓴다. */
  serverNow(): number;

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
  /** 첫 입장 기기를 한 팀에 묶는다. 다른 팀에 묶인 기기면 device-locked 오류를 낸다. */
  joinTeam(eventId: string, teamId: string): Promise<TeamSession>;
  /** 이 기기의 번호와 묶여 있는 팀(잠금 해제를 요청할 때 학생 화면에 보여 준다) */
  getMyDevice(eventId: string): Promise<DeviceInfo>;
  /** 학급의 팀에 입장한 기기 목록(교사) */
  listClassDevices(eventId: string, classId: string): Promise<TeamDevice[]>;
  /** 팀을 잘못 고른 기기의 잠금을 푼다(교사). 제출과 카드는 그대로 남는다. */
  unlockDevice(eventId: string, deviceId: string): Promise<void>;

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
  /** 확정한 순위를 고친다. 고르기 전 카드 보상만 새 순위에 맞추고 받은 보상은 그대로 둔다. */
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

  // 카드 보상과 네 조각 성장
  getTeamRewardView(eventId: string, teamId: string): Promise<TeamRewardView>;
  /** 제시된 후보 중 하나를 골라 받는다. 같은 보상은 한 번만 받을 수 있다. */
  claimCardAward(input: ClaimCardAwardInput): Promise<ClaimCardAwardOutcome>;
  listClassCardBoards(eventId: string, grade: Grade): Promise<ClassCardBoard[]>;
  getTeacherClassCards(eventId: string, classId: string): Promise<TeacherClassCards>;

  // 팀 이동과 QR 체크인
  /** 이 기기가 입장한 팀. 미션 교실 QR 주소에는 팀이 없어서 기기에 묶인 팀으로 체크인한다. */
  getMyTeam(eventId: string): Promise<Team | null>;
  /** 미션 교실 QR 체크인. 같은 QR을 다시 찍어도 기록은 하나다. */
  checkInStation(input: CheckInInput): Promise<CheckInOutcome>;
  getTeamTourStatus(eventId: string, teamId: string): Promise<TeamTourStatus>;

  // 실시간 운영 대시보드
  /** roundNo를 주지 않으면 활동 중에는 지금 라운드, 이동 중에는 다음 라운드(입장 확인용)를 보여 준다. */
  getOpsDashboard(eventId: string, grade: Grade, roundNo?: RoundNo): Promise<OpsDashboard>;
  getClassOpsDetail(eventId: string, classId: string): Promise<ClassOpsDetail>;
  /** 현재 학년의 팀 이동·부스·카드 상태가 바뀔 때마다 알린다. */
  subscribeOps(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  getMissionRoundState(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<MissionRoundState>;
  getStationArrivals(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<StationArrivals>;
  /** 부스 교사의 “미션 시작”. 입장한 팀이 진행 중이 된다. 다시 눌러도 시작 시각은 그대로다. */
  startStationRound(input: StartStationInput): Promise<MissionRoundState>;
  /** QR을 찍지 못한 팀을 교사가 직접 입장 처리한다(수동 복구). */
  markTeamArrived(input: MarkArrivedInput): Promise<TeamMissionState>;

  // 학급 전체 최종 미션
  getFinalBoard(eventId: string, grade: Grade): Promise<FinalBoard>;
  /**
   * 학년 최종 미션의 변화를 알린다. classId를 주면 세션과 그 학급의 변화만 알린다
   * (학급 화면이 다른 반의 진행 때문에 다시 읽지 않게 한다).
   */
  subscribeFinal(
    eventId: string,
    grade: Grade,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
    classId?: string,
  ): Unsubscribe;
  /** 총괄 운영자가 학년의 최종 미션을 연다. 그 전에는 담임교사의 시작 버튼이 꺼져 있다. */
  openFinal(input: OpenFinalInput): Promise<FinalSession>;
  /** 어느 반도 시작하기 전에만 제한 시간을 바꾼다. */
  setFinalDuration(eventId: string, grade: Grade, durationLimitSec: number): Promise<FinalSession>;
  /** 모든 반이 제출한 뒤 결과를 공개한다. */
  publishFinalResults(eventId: string, grade: Grade): Promise<FinalSession>;
  getClassFinalView(eventId: string, classId: string): Promise<ClassFinalView>;
  /** 서버 시각으로 시작을 한 번만 기록하고 카드·힌트 스냅샷을 고정한다. */
  startClassFinal(input: StartClassFinalInput): Promise<ClassFinalView>;
  selectFinalChoice(input: SelectFinalChoiceInput): Promise<ClassFinalView>;
  /** 현재 문제의 오답 보기 하나를 지운다. 한 문제에 한 번, 보유 수 안에서만. */
  applyFinalHint(input: FinalQuestionActionInput): Promise<ClassFinalView>;
  /** 답을 확정하고 다음 문제로 간다. 마지막 문제면 전체를 제출한다. */
  confirmFinalAnswer(input: FinalQuestionActionInput): Promise<ClassFinalView>;
  /** 제한 시간이 끝났을 때 저장된 답안으로 마감한다. 시간이 남아 있으면 아무 일도 하지 않는다. */
  closeExpiredClassFinal(eventId: string, classId: string): Promise<ClassFinalView>;
  /** 총괄 운영자의 강제 마감(자동 제출이 안 된 학급). 사유를 기록한다. */
  forceCloseClassFinal(input: FinalAdminActionInput): Promise<FinalClassState>;
  adjustFinalResult(input: AdjustFinalResultInput): Promise<FinalClassState>;
  /** 총괄 운영자가 학급 최종 미션을 시작 전으로 되돌린다. 다시 시작하면 새 스냅샷을 만든다. */
  resetClassFinal(input: FinalAdminActionInput): Promise<FinalClassState>;

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
  /** 리허설용: 역할과 담당을 골라 교사로 들어간다. */
  signInAs(
    role: TeacherRole,
    assignment?: { missionId?: string; classId?: string },
  ): TeacherProfile;
}
