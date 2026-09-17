import { Bytes, Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import { CARD_TYPES } from '../../domain/cards';
import { emptyFinalSession, finalResponseId } from '../../domain/finalMission';
import type { TeamMissionRecord } from '../../domain/tour';
import { RepositoryError } from '../errors';
import type {
  CardAward,
  CardType,
  ClassInfo,
  DrawingFile,
  FestivalEvent,
  FinalClassState,
  FinalResponse,
  FinalSession,
  Grade,
  Mission,
  MissionConfig,
  MissionNo,
  MissionResult,
  RoundNo,
  RoundStatus,
  Submission,
  SubmissionAnswer,
  Team,
  TeamNo,
} from '../../domain/types';

/** Firestore Timestamp를 epoch ms로 바꾼다. 서버 시각이 아직 반영되지 않았으면 null. */
export function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return null;
}

function requireData(snapshot: DocumentSnapshot<DocumentData>, label: string): DocumentData {
  const data = snapshot.data();
  if (!data) throw new RepositoryError('not-found', `${label} 정보를 찾을 수 없어요.`);
  return data;
}

export function mapEvent(snapshot: DocumentSnapshot<DocumentData>): FestivalEvent {
  const data = requireData(snapshot, '행사');
  return {
    id: snapshot.id,
    title: String(data.title ?? ''),
    schoolName: String(data.schoolName ?? ''),
    status: data.status,
    activeGrade: (data.activeGrade ?? null) as Grade | null,
    activeRound: (data.activeRound ?? 0) as FestivalEvent['activeRound'],
    roundEndsAt: toMillis(data.roundEndsAt),
    pausedRemainingMs: typeof data.pausedRemainingMs === 'number' ? data.pausedRemainingMs : null,
    roundEndedAt: toMillis(data.roundEndedAt),
    roundDurationMs: typeof data.roundDurationMs === 'number' ? data.roundDurationMs : 8 * 60_000,
    moveDurationMs: typeof data.moveDurationMs === 'number' ? data.moveDurationMs : 2 * 60_000,
    updatedAt: toMillis(data.updatedAt) ?? 0,
  };
}

export function mapClass(snapshot: DocumentSnapshot<DocumentData>): ClassInfo {
  const data = requireData(snapshot, '학급');
  return {
    id: snapshot.id,
    grade: data.grade as Grade,
    classNo: Number(data.classNo),
    displayName: String(data.displayName ?? `${data.grade}학년 ${data.classNo}반`),
    status: data.status ?? 'ready',
  };
}

export function mapTeam(snapshot: DocumentSnapshot<DocumentData>): Team {
  const data = requireData(snapshot, '팀');
  return {
    id: snapshot.id,
    classId: String(data.classId),
    grade: data.grade as Grade,
    classNo: Number(data.classNo),
    teamNo: data.teamNo as TeamNo,
    displayName: String(data.displayName ?? `${data.grade}학년 ${data.classNo}반 ${data.teamNo}팀`),
    status: data.status ?? 'ready',
  };
}

export function mapMission(snapshot: DocumentSnapshot<DocumentData>): Mission {
  const data = requireData(snapshot, '미션');
  return {
    id: snapshot.id,
    no: data.no as MissionNo,
    type: data.type,
    title: String(data.title ?? ''),
    room: String(data.room ?? ''),
    cardType: data.cardType,
    summary: String(data.summary ?? ''),
    teacherJudged: data.teacherJudged === true,
    enabled: data.enabled !== false,
    config: normalizeMissionConfig(data.config),
  };
}

/** 예전 한 문제 골든벨을 옮길 때 쓰는 문제 ID */
export const LEGACY_GOLDEN_BELL_QUESTION_ID = 'q1';

/**
 * 예전 형식으로 저장된 설정을 지금 형식으로 바꾼다.
 * 골든벨은 처음에 문제 하나(question, choices, answerIndex)만 저장했다.
 */
export function normalizeMissionConfig(raw: unknown): MissionConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.type === 'golden_bell' && !Array.isArray(config.questions)) {
    const hasLegacyQuestion = typeof config.question === 'string' && Array.isArray(config.choices);
    return {
      type: 'golden_bell',
      questions: hasLegacyQuestion
        ? [
            {
              id: LEGACY_GOLDEN_BELL_QUESTION_ID,
              question: String(config.question),
              choices: (config.choices as unknown[]).map(String),
              answerIndex: Number(config.answerIndex ?? 0),
              explanation: String(config.explanation ?? ''),
            },
          ]
        : [],
    };
  }
  return config as unknown as MissionConfig;
}

/** 예전 형식 답안을 지금 형식으로 바꾼다. */
export function normalizeAnswer(raw: unknown): SubmissionAnswer {
  const answer = (raw ?? {}) as Record<string, unknown>;
  if (answer.type === 'golden_bell' && typeof answer.selections !== 'object') {
    return {
      type: 'golden_bell',
      selections:
        typeof answer.choiceIndex === 'number'
          ? { [LEGACY_GOLDEN_BELL_QUESTION_ID]: answer.choiceIndex }
          : {},
    };
  }
  if (answer.type === 'drawing' && typeof answer.byteSize !== 'number') {
    return {
      type: 'drawing',
      strokeCount: Number(answer.strokeCount ?? 0),
      mimeType: 'image/webp',
      byteSize: 0,
      width: 0,
      height: 0,
    };
  }
  return answer as unknown as SubmissionAnswer;
}

/**
 * 학생이 만든 완전한 제출 문서인지.
 * 예전 순위 확정 코드가 제출하지 않은 팀에도 점수만 있는 빈 문서를 만든 적이 있어 걸러 낸다.
 */
export function isCompleteSubmission(data: DocumentData | undefined): data is DocumentData {
  return (
    data !== undefined &&
    typeof data.teamId === 'string' &&
    typeof data.missionId === 'string' &&
    typeof data.answer === 'object' &&
    data.answer !== null
  );
}

export function mapSubmission(snapshot: DocumentSnapshot<DocumentData>): Submission {
  const data = requireData(snapshot, '제출물');
  return {
    id: snapshot.id,
    teamId: String(data.teamId),
    classId: String(data.classId),
    missionId: String(data.missionId),
    grade: data.grade as Grade,
    roundNo: data.roundNo as RoundNo,
    status: data.status ?? 'draft',
    answer: normalizeAnswer(data.answer),
    score: typeof data.score === 'number' ? data.score : null,
    reopened: data.reopened === true,
    submittedAt: toMillis(data.submittedAt),
    updatedAt: toMillis(data.updatedAt) ?? 0,
  };
}

export function mapResult(snapshot: DocumentSnapshot<DocumentData>): MissionResult {
  const data = requireData(snapshot, '순위');
  return {
    id: snapshot.id,
    missionId: String(data.missionId),
    grade: data.grade as Grade,
    roundNo: data.roundNo as RoundNo,
    teamId: String(data.teamId),
    score: Number(data.score ?? 0),
    rank: Number(data.rank ?? 0),
    finalizedBy: String(data.finalizedBy ?? ''),
    finalizedAt: toMillis(data.finalizedAt) ?? 0,
  };
}

function isCardType(value: unknown): value is CardType {
  return typeof value === 'string' && (CARD_TYPES as readonly string[]).includes(value);
}

export function mapCardAward(snapshot: DocumentSnapshot<DocumentData>): CardAward {
  const data = requireData(snapshot, '카드 보상');
  const offeredTypes = Array.isArray(data.offeredTypes) ? data.offeredTypes.filter(isCardType) : [];
  const status = data.status === 'claimed' ? 'claimed' : 'pending';
  return {
    id: snapshot.id,
    resultId: String(data.resultId ?? snapshot.id),
    grade: data.grade as Grade,
    classId: String(data.classId),
    teamId: String(data.teamId),
    missionId: String(data.missionId),
    roundNo: data.roundNo as RoundNo,
    rank: Number(data.rank ?? 0),
    selectionMode:
      data.selectionMode === 'choose_three' || data.selectionMode === 'choose_two'
        ? data.selectionMode
        : 'automatic',
    offeredTypes,
    selectedType: isCardType(data.selectedType) ? data.selectedType : null,
    status,
    createdAt: toMillis(data.createdAt) ?? 0,
    // 서버 시각이 아직 반영되지 않은 쓰기 직후에도 받은 상태로 본다.
    claimedAt: toMillis(data.claimedAt) ?? (status === 'claimed' ? 0 : null),
  };
}

export function mapDrawingFile(snapshot: DocumentSnapshot<DocumentData>): DrawingFile {
  const data = requireData(snapshot, '그림');
  const bytes =
    data.imageBytes instanceof Bytes ? data.imageBytes.toUint8Array() : new Uint8Array();
  return {
    teamId: String(data.teamId ?? snapshot.id),
    missionId: String(data.missionId ?? ''),
    promptId: String(data.promptId ?? ''),
    mimeType: String(data.mimeType ?? 'image/webp'),
    byteSize: typeof data.byteSize === 'number' ? data.byteSize : bytes.length,
    width: Number(data.width ?? 0),
    height: Number(data.height ?? 0),
    bytes,
    submittedAt: toMillis(data.submittedAt),
  };
}

// ---- 팀 이동·부스·최종 미션 ----

/** 부스 문서. resultTeamIds는 순위를 확정한 팀으로, 대시보드가 결과 문서를 다시 읽지 않게 해 준다. */
export interface BoothDoc {
  id: string;
  grade: Grade;
  missionId: string;
  roundNo: RoundNo;
  status: 'ready' | 'active' | 'completed';
  startedAt: number | null;
  completedAt: number | null;
  resultFinalizedAt: number | null;
  resultTeamIds: string[];
  updatedBy: string | null;
}

export interface RoundDoc {
  grade: Grade;
  roundNo: RoundNo;
  status: RoundStatus;
  startedAt: number | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 저장된 팀 이동 기록. 진행 중·완료 여부는 저장하지 않고 부스 문서로 계산한다. */
export function mapTeamMissionRecord(id: string, data: DocumentData): TeamMissionRecord {
  return {
    id,
    grade: data.grade as Grade,
    classId: String(data.classId),
    teamId: String(data.teamId),
    teamNo: data.teamNo as TeamNo,
    roundNo: data.roundNo as RoundNo,
    expectedMissionId: String(data.expectedMissionId),
    actualMissionId: stringOrNull(data.actualMissionId),
    wrongStationId: stringOrNull(data.wrongStationId),
    manualReview: data.manualReview === true,
    checkedInAt: toMillis(data.checkedInAt),
    startedAt: null,
    completedAt: null,
    resultId: null,
    updatedAt: toMillis(data.updatedAt) ?? 0,
  };
}

export function mapBooth(id: string, data: DocumentData): BoothDoc {
  return {
    id,
    grade: data.grade as Grade,
    missionId: String(data.missionId),
    roundNo: data.roundNo as RoundNo,
    status: data.status === 'active' || data.status === 'completed' ? data.status : 'ready',
    startedAt: toMillis(data.startedAt),
    completedAt: toMillis(data.completedAt),
    resultFinalizedAt: toMillis(data.resultFinalizedAt),
    resultTeamIds: Array.isArray(data.resultTeamIds) ? data.resultTeamIds.map(String) : [],
    updatedBy: stringOrNull(data.updatedBy),
  };
}

export function mapRound(data: DocumentData): RoundDoc {
  return {
    grade: data.grade as Grade,
    roundNo: data.roundNo as RoundNo,
    status: (data.status as RoundStatus | undefined) ?? 'waiting',
    startedAt: toMillis(data.startedAt),
  };
}

export function mapFinalSession(grade: Grade, data: DocumentData | undefined): FinalSession {
  const base = emptyFinalSession(grade);
  if (!data) return base;
  const status = data.status as FinalSession['status'];
  return {
    grade,
    status: ['open', 'results_hidden', 'results_published', 'closed'].includes(status)
      ? status
      : 'locked',
    questionCount: numberOr(data.questionCount, base.questionCount),
    durationLimitSec: numberOr(data.durationLimitSec, base.durationLimitSec),
    openedAt: toMillis(data.openedAt),
    openedBy: stringOrNull(data.openedBy),
    forceOpenReason: stringOrNull(data.forceOpenReason),
    resultsPublishedAt: toMillis(data.resultsPublishedAt),
  };
}

/**
 * 학급 최종 상태. 제출 시각은 서버가 기록하므로 소요 시간은 읽을 때 계산한다.
 * 시간 마감은 제한 시간에 제출한 것으로 보고, 총괄 운영자가 고친 값이 있으면 그 값을 쓴다.
 */
export function mapFinalClassState(
  classId: string,
  data: DocumentData,
  durationLimitSec: number,
): FinalClassState {
  const startedAt = toMillis(data.startedAt);
  const status = data.status === 'submitted' || data.status === 'timeout' ? data.status : 'active';
  const limitMs = numberOr(data.durationLimitSec, durationLimitSec) * 1000;
  let submittedAt = status === 'active' ? null : toMillis(data.submittedAt);
  let durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
  if (status !== 'active' && startedAt !== null) {
    // 제출 직후 서버 시각이 아직 없으면 제한 시간 안에서 추정한다.
    const end = Math.min(submittedAt ?? startedAt + limitMs, startedAt + limitMs);
    submittedAt = status === 'timeout' ? end : (submittedAt ?? end);
    durationMs ??= Math.max(0, Math.min(end - startedAt, limitMs));
  }
  return {
    classId,
    grade: data.grade as Grade,
    status,
    currentQuestionIndex: numberOr(data.currentQuestionIndex, 0),
    completedCardTypeCountSnapshot: numberOr(data.completedCardTypeCountSnapshot, 0),
    allFiveCardsCompletedSnapshot: data.allFiveCardsCompletedSnapshot === true,
    hintTotal: numberOr(data.hintTotal, 0),
    hintUsed: numberOr(data.hintUsed, 0),
    startedAt,
    submittedAt,
    durationMs,
    correctCount: typeof data.correctCount === 'number' ? data.correctCount : null,
    finalRank: typeof data.finalRank === 'number' ? data.finalRank : null,
    manualOverride: data.manualOverride === true,
    overrideReason: stringOrNull(data.overrideReason),
    overrideBy: stringOrNull(data.overrideBy),
    updatedAt: toMillis(data.updatedAt) ?? 0,
  };
}

/** 학급의 응답 문서 하나(answers["0"~"9"])를 문제별 응답으로 펼친다. */
export function mapFinalResponses(
  classId: string,
  grade: Grade,
  data: DocumentData | undefined,
): {
  index: number;
  requestIds: { hint: string | null; confirm: string | null };
  response: FinalResponse;
}[] {
  const answers = (data?.answers ?? {}) as Record<string, DocumentData>;
  return Object.entries(answers)
    .map(([key, answer]) => {
      const questionId = String(answer.questionId ?? '');
      return {
        index: Number(key),
        requestIds: {
          hint: stringOrNull(answer.hintRequestId),
          confirm: stringOrNull(answer.confirmRequestId),
        },
        response: {
          id: finalResponseId(classId, questionId),
          classId,
          grade,
          questionId,
          selectedChoiceId: stringOrNull(answer.selectedChoiceId),
          hintUsed: answer.hintUsed === true,
          removedChoiceId: stringOrNull(answer.removedChoiceId),
          confirmedAt: toMillis(answer.confirmedAt),
          updatedAt: toMillis(answer.updatedAt) ?? 0,
        },
      };
    })
    .filter((item) => Number.isInteger(item.index) && item.response.questionId !== '')
    .sort((a, b) => a.index - b.index);
}
