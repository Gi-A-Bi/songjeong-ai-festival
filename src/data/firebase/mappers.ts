import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import { RepositoryError } from '../errors';
import type {
  ClassInfo,
  DrawTicket,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
  MissionConfig,
  MissionNo,
  MissionResult,
  RoundNo,
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
    config: data.config as MissionConfig,
  };
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
    answer: data.answer as SubmissionAnswer,
    score: typeof data.score === 'number' ? data.score : null,
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

export function mapTicket(snapshot: DocumentSnapshot<DocumentData>): DrawTicket {
  const data = requireData(snapshot, '뽑기권');
  return {
    id: snapshot.id,
    teamId: String(data.teamId),
    classId: String(data.classId),
    sourceResultId: String(data.sourceResultId ?? ''),
    cardType: data.cardType,
    claimedAt: toMillis(data.claimedAt),
    createdAt: toMillis(data.createdAt) ?? 0,
  };
}

export function mapExchange(snapshot: DocumentSnapshot<DocumentData>): Exchange {
  const data = requireData(snapshot, '교환 기록');
  return {
    id: snapshot.id,
    requestId: String(data.requestId ?? ''),
    fromClassId: String(data.fromClassId),
    toClassId: String(data.toClassId),
    cardType: data.cardType,
    quantity: Number(data.quantity ?? 0),
    status: data.status ?? 'completed',
    createdBy: String(data.createdBy ?? ''),
    createdAt: toMillis(data.createdAt) ?? 0,
    reversesExchangeId: (data.reversesExchangeId ?? null) as string | null,
  };
}
