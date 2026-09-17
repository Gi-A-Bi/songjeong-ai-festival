import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../src/config';
import { FirestoreEventRepository } from '../src/data/firebase/FirestoreEventRepository';
import { getFirebase } from '../src/data/firebase/firebaseApp';
import { isRepositoryError } from '../src/data/errors';
import type { ClassFinalView } from '../src/data/EventRepository';
import type { TeacherRole } from '../src/domain/types';

/*
 * v3 기능의 Firestore 저장소 동작: 교실 QR 체크인, 부스, 운영 대시보드, 학급 전체 최종 미션.
 * 보안 규칙이 켜진 에뮬레이터에서 실제 역할(총괄·부스·담임·학생)로 로그인해 확인한다.
 */
const PROJECT_ID = 'demo-songjeong';
const FIRESTORE_HOST = 'http://127.0.0.1:8080';
const AUTH_HOST = 'http://127.0.0.1:9099';
const PASSWORD = 'test-password';
const EVENT = DEFAULT_EVENT_ID;
const DOCS = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** 샘플 최종 미션 10문제의 정답(src/data/mock/finalQuestions.ts) */
const SAMPLE_ANSWERS = ['b', 'c', 'a', 'b', 'b', 'a', 'b', 'c', 'b', 'c'];

let repository: FirestoreEventRepository;

async function clearEmulators() {
  await fetch(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

type Plain = string | number | boolean | null | Date | string[];

function encode(value: Plain): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
}

/** 보안 규칙을 거치지 않고(관리자 권한) 문서를 넣는다. */
async function seedDoc(path: string, data: Record<string, Plain>) {
  const response = await fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
    }),
  });
  if (!response.ok) throw new Error(`문서 생성 실패(${path}): ${response.status}`);
}

async function signInAs(
  name: string,
  role: TeacherRole,
  assignment: { missionId?: string; classId?: string } = {},
) {
  const { auth } = getFirebase();
  await repository.signOutTeacher();
  await signOut(auth).catch(() => undefined);
  const email = `${name}@songjeong.test`;
  try {
    await signInWithEmailAndPassword(auth, email, PASSWORD);
  } catch {
    await createUserWithEmailAndPassword(auth, email, PASSWORD);
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('교사 로그인 실패');
  await seedDoc(`teachers/${uid}`, {
    displayName: name,
    email,
    role,
    active: true,
    missionId: assignment.missionId ?? null,
    classId: assignment.classId ?? null,
  });
  const profile = await repository.restoreTeacher();
  expect(profile?.role).toBe(role);
}

const signInAsAdmin = () => signInAs('admin', 'admin');

async function signInAsStudent(teamId: string) {
  await repository.signOutTeacher();
  await repository.joinTeam(EVENT, teamId);
}

/** 학급이 같은 종류의 카드를 네 조각 모아 한 종류를 완성한 상태(힌트 1개) */
async function seedCompletedCard(classId: string, grade: number) {
  for (const roundNo of [1, 2, 3, 4]) {
    const teamId = `${classId}-t${roundNo}`;
    const id = `seed__g${grade}__r${roundNo}__${teamId}`;
    await seedDoc(`events/${EVENT}/cardAwards/${id}`, {
      resultId: id,
      grade,
      classId,
      teamId,
      missionId: 'golden-bell',
      roundNo,
      rank: 3,
      selectionMode: 'automatic',
      offeredTypes: ['thinking'],
      selectedType: 'thinking',
      status: 'claimed',
      createdAt: new Date(),
      claimedAt: new Date(),
    });
  }
}

beforeAll(() => {
  repository = new FirestoreEventRepository();
});

beforeEach(async () => {
  await repository.signOutTeacher();
  await clearEmulators();
});

describe('교실 QR 체크인과 운영 대시보드 (에뮬레이터)', () => {
  it('학생 체크인 → 부스 시작 → 결과 확정이 대시보드에 입장·진행·완료로 나타난다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await repository.setActiveGrade(EVENT, 4);
    await repository.controlRound(EVENT, 'start');
    expect(Math.abs(repository.serverNow() - Date.now())).toBeLessThan(5000);

    // 4학년 1반 1팀은 1라운드에 1번 미션(골든벨, 시청각실)으로 간다.
    const teamId = 'g4-c1-t1';
    await signInAsStudent(teamId);
    const before = await repository.getTeamTourStatus(EVENT, teamId);
    expect(before.roundNo).toBe(1);
    expect(before.expectedMission?.id).toBe('golden-bell');
    expect(before.state?.status).toBe('scheduled');

    const wrong = await repository.checkInStation({ eventId: EVENT, teamId, stationId: 'drawing' });
    expect(wrong.kind).toBe('wrong_station');
    expect(wrong.expectedMission.id).toBe('golden-bell');
    expect(wrong.state.checkedInAt).toBeNull();
    expect(wrong.state.alertCodes).toContain('wrong_station');

    const arrived = await repository.checkInStation({
      eventId: EVENT,
      teamId,
      stationId: 'golden-bell',
    });
    expect(arrived.kind).toBe('checked_in');
    expect(arrived.state.status).toBe('checked_in');
    expect(arrived.state.alertCodes).toEqual([]);

    // 같은 QR을 다시 찍어도 기록은 하나이고 입장 시각은 그대로다.
    const again = await repository.checkInStation({
      eventId: EVENT,
      teamId,
      stationId: 'golden-bell',
    });
    expect(again.kind).toBe('already_checked_in');
    expect(again.state.checkedInAt).toBe(arrived.state.checkedInAt);

    // 다른 팀으로는 체크인할 수 없다(보안 규칙).
    await expect(
      repository.checkInStation({ eventId: EVENT, teamId: 'g4-c2-t1', stationId: 'golden-bell' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    // 부스 교사: 입장 현황, 직접 입장 처리, 미션 시작
    await signInAs('station-bell', 'station_teacher', { missionId: 'golden-bell' });
    const revisions: number[] = [];
    const stop = repository.subscribeOps(
      EVENT,
      4,
      (revision) => revisions.push(revision),
      (error) => {
        throw error;
      },
    );
    await vi.waitFor(() => expect(revisions.length).toBeGreaterThan(0));

    const arrivals = await repository.getStationArrivals(EVENT, 'golden-bell', 4, 1);
    expect(arrivals.booth.status).toBe('ready');
    expect(arrivals.movements).toHaveLength(5);
    expect(arrivals.movements.filter((item) => item.checkedInAt !== null)).toHaveLength(1);

    const manual = await repository.markTeamArrived({
      eventId: EVENT,
      teamId: 'g4-c2-t1',
      missionId: 'golden-bell',
      roundNo: 1,
    });
    expect(manual.checkedInAt).not.toBeNull();
    // 체크인이 구독으로 전해져 입장 현황을 다시 읽게 한다.
    await vi.waitFor(() => expect(revisions[revisions.length - 1]).toBeGreaterThan(0));

    const started = await repository.startStationRound({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
    });
    expect(started.status).toBe('active');
    expect(started.startedAt).not.toBeNull();
    const startedAgain = await repository.startStationRound({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
    });
    expect(startedAgain.startedAt).toBe(started.startedAt);

    await vi.waitFor(async () => {
      const current = await repository.getStationArrivals(EVENT, 'golden-bell', 4, 1);
      const statuses = current.movements.map((item) => item.status);
      // 입장한 두 팀만 진행 중이 된다.
      expect(statuses.filter((status) => status === 'active')).toHaveLength(2);
      expect(statuses.filter((status) => status === 'scheduled')).toHaveLength(3);
    });

    // 담당이 아닌 부스는 시작할 수 없다.
    await expect(
      repository.startStationRound({ eventId: EVENT, missionId: 'drawing', grade: 4, roundNo: 1 }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    // 결과 확정 → 팀은 완료, 부스는 결과 확정. 다시 확정해도 카드 보상은 늘지 않는다.
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1);
    const entries = participants.map((participant, index) => ({
      teamId: participant.team.id,
      score: 500 - index * 100,
      rank: index + 1,
    }));
    const finalized = await repository.finalizeRanking({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-1',
      entries,
    });
    expect(finalized.awards).toHaveLength(5);
    const retried = await repository.finalizeRanking({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-2',
      entries,
    });
    expect(retried.alreadyFinalized).toBe(true);
    expect(retried.awards).toHaveLength(5);
    stop();

    // 총괄 대시보드
    await signInAsAdmin();
    await vi.waitFor(async () => {
      const dashboard = await repository.getOpsDashboard(EVENT, 4);
      expect(dashboard.summary).toMatchObject({
        grade: 4,
        roundNo: 1,
        phase: 'active',
        expectedTeams: 25,
        checkedInTeams: 5,
        completedTeams: 5,
      });
      const bell = dashboard.stations.find((station) => station.mission.id === 'golden-bell');
      expect(bell?.round.status).toBe('completed');
      expect(bell?.teams.every((cell) => cell.state.status === 'completed')).toBe(true);
      const types = dashboard.activity.map((item) => item.type);
      expect(types).toContain('check_in');
      expect(types).toContain('mission_started');
      expect(types).toContain('result_finalized');
      expect(types).toContain('round_changed');
      // 화면 조회나 타이머 변화는 기록하지 않는다.
      expect(new Set(dashboard.activity.map((item) => item.id)).size).toBe(
        dashboard.activity.length,
      );
    });

    // 학급 상세: 팀 위치, 순위, 예상 힌트 수
    const detail = await repository.getClassOpsDetail(EVENT, 'g4-c1');
    expect(detail.teams).toHaveLength(5);
    expect(detail.teams[0].results[0]).toMatchObject({ roundNo: 1, rank: 1 });
    expect(detail.hintPreview).toBe(0);
    expect(detail.finalStatus).toBe('locked');

    // 학생 기기에서도 완료로 보인다.
    await signInAsStudent(teamId);
    const after = await repository.getTeamTourStatus(EVENT, teamId);
    expect(after.state?.status).toBe('completed');
    expect(after.state?.resultId).toBe('golden-bell__g4__r1__g4-c1-t1');
  });

  it('이동 시간에 찍은 QR은 다음 라운드 입장으로 기록된다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await repository.setActiveGrade(EVENT, 4);
    await repository.controlRound(EVENT, 'start');
    await repository.controlRound(EVENT, 'end');

    // 1팀의 2라운드 미션은 2번(틀린그림 찾기)이다.
    const teamId = 'g4-c1-t1';
    await signInAsStudent(teamId);
    const outcome = await repository.checkInStation({
      eventId: EVENT,
      teamId,
      stationId: 'error-hunt',
    });
    expect(outcome.kind).toBe('checked_in');
    expect(outcome.roundNo).toBe(2);
  });

  it('같은 QR을 거의 동시에 두 번 찍어도 둘 다 성공으로 끝나고 기록은 하나다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await repository.setActiveGrade(EVENT, 4);
    await repository.controlRound(EVENT, 'start');

    const teamId = 'g4-c1-t1';
    await signInAsStudent(teamId);
    // 다른 교실을 먼저 찍은 뒤, 올바른 교실을 두 번 동시에 찍는다(연타·같은 팀의 두 기기).
    await repository.checkInStation({ eventId: EVENT, teamId, stationId: 'drawing' });
    const input = { eventId: EVENT, teamId, stationId: 'golden-bell' };
    const outcomes = await Promise.all([
      repository.checkInStation(input),
      repository.checkInStation(input),
      repository.checkInStation(input),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'already_checked_in',
      'already_checked_in',
      'checked_in',
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.state.checkedInAt)).size).toBe(1);
  });

  it('투어 중이 아닌 학년의 팀은 체크인할 수 없다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await repository.setActiveGrade(EVENT, 4);
    await signInAsStudent('g5-c1-t1');
    await expect(
      repository.checkInStation({ eventId: EVENT, teamId: 'g5-c1-t1', stationId: 'golden-bell' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });
});

describe('학급 전체 최종 미션 (에뮬레이터)', () => {
  const CLASS_ID = 'g3-c1';

  async function prepareOpenFinal() {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await seedCompletedCard(CLASS_ID, 3);
    // 투어를 마치지 않았으므로 사유를 적어 강제로 연다.
    await expect(
      repository.openFinal({ eventId: EVENT, grade: 3, force: false, reason: '' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
    const session = await repository.openFinal({
      eventId: EVENT,
      grade: 3,
      force: true,
      reason: '리허설',
    });
    expect(session.status).toBe('open');
    expect(session.forceOpenReason).toBe('리허설');
  }

  async function answerAndConfirm(view: ClassFinalView, choiceId: string, tag: string) {
    const questionId = view.question?.id;
    if (!questionId) throw new Error('현재 문제가 없어요');
    await repository.selectFinalChoice({ eventId: EVENT, classId: CLASS_ID, questionId, choiceId });
    return repository.confirmFinalAnswer({
      eventId: EVENT,
      classId: CLASS_ID,
      questionId,
      requestId: `confirm-${tag}`,
    });
  }

  it('열기 전에는 담임교사가 시작할 수 없다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    const view = await repository.getClassFinalView(EVENT, CLASS_ID);
    expect(view.status).toBe('locked');
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: CLASS_ID, requestId: 'start-1' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('시작 → 10문제 풀이 → 제출 → 결과 공개까지 점수는 공개 전에 담임교사에게 보이지 않는다', async () => {
    await prepareOpenFinal();

    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    // 다른 반은 시작할 수 없다.
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: 'g3-c2', requestId: 'start-x' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    let view = await repository.startClassFinal({
      eventId: EVENT,
      classId: CLASS_ID,
      requestId: 'start-1',
    });
    expect(view.status).toBe('active');
    expect(view.question?.id).toBe('q1');
    expect(view.question).not.toHaveProperty('answerChoiceId');
    expect(view.question).not.toHaveProperty('hintRemoveChoiceId');
    // 완성 카드 1종 → 힌트 1개가 스냅샷으로 고정된다.
    expect(view.state).toMatchObject({
      completedCardTypeCountSnapshot: 1,
      allFiveCardsCompletedSnapshot: false,
      hintTotal: 1,
      hintUsed: 0,
    });
    const startedAt = view.state.startedAt;
    expect(startedAt).not.toBeNull();

    // 다시 시작해도(새로고침·연타) 시작 시각과 스냅샷은 그대로다.
    const restarted = await repository.startClassFinal({
      eventId: EVENT,
      classId: CLASS_ID,
      requestId: 'start-2',
    });
    expect(restarted.state.startedAt).toBe(startedAt);

    // 확정 전에는 답을 바꿀 수 있다.
    const q1 = { eventId: EVENT, classId: CLASS_ID, questionId: 'q1' };
    await repository.selectFinalChoice({ ...q1, choiceId: 'd' });
    // 힌트: 오답 하나(d)가 지워지고, 고른 보기였다면 선택이 풀린다.
    view = await repository.applyFinalHint({ ...q1, requestId: 'hint-1' });
    expect(view.response).toMatchObject({
      hintUsed: true,
      removedChoiceId: 'd',
      selectedChoiceId: null,
    });
    expect(view.state.hintUsed).toBe(1);
    // 같은 요청 재시도는 두 번 차감하지 않고, 새 요청은 거부한다.
    view = await repository.applyFinalHint({ ...q1, requestId: 'hint-1' });
    expect(view.state.hintUsed).toBe(1);
    await expect(repository.applyFinalHint({ ...q1, requestId: 'hint-2' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    // 지워진 보기는 고를 수 없고, 고르지 않으면 확정할 수 없다.
    await expect(repository.selectFinalChoice({ ...q1, choiceId: 'd' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    await expect(
      repository.confirmFinalAnswer({ ...q1, requestId: 'confirm-early' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));

    view = await answerAndConfirm(view, SAMPLE_ANSWERS[0], 'q1');
    expect(view.question?.id).toBe('q2');
    expect(view.state.currentQuestionIndex).toBe(1);
    // 같은 확정 요청을 다시 보내도 한 문제만 넘어간다.
    view = await repository.confirmFinalAnswer({ ...q1, requestId: 'confirm-q1' });
    expect(view.question?.id).toBe('q2');
    // 확정한 문제는 고칠 수 없다.
    await expect(repository.selectFinalChoice({ ...q1, choiceId: 'a' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );

    // 새로고침: 현재 문제와 고른 답이 복구된다.
    await repository.selectFinalChoice({
      eventId: EVENT,
      classId: CLASS_ID,
      questionId: 'q2',
      choiceId: 'a',
    });
    const restored = await repository.getClassFinalView(EVENT, CLASS_ID);
    expect(restored.question?.id).toBe('q2');
    expect(restored.response?.selectedChoiceId).toBe('a');
    expect(restored.state.startedAt).toBe(startedAt);

    // 2~10번: 마지막 문제만 틀린다 → 정답 9개
    for (let index = 1; index < 10; index += 1) {
      const choice = index === 9 ? 'a' : SAMPLE_ANSWERS[index];
      view = await answerAndConfirm(view, choice, `q${index + 1}`);
    }
    expect(view.status).toBe('submitted');
    expect(view.question).toBeNull();
    expect(view.state.durationMs).toBeGreaterThanOrEqual(0);
    expect(view.state.durationMs).toBeLessThan(60_000);
    // 공개 전에는 담임교사에게 정답 수와 순위를 주지 않는다.
    expect(view.canViewResults).toBe(false);
    expect(view.state.correctCount).toBeNull();

    const hidden = await repository.getFinalBoard(EVENT, 3);
    expect(hidden.canViewResults).toBe(false);
    expect(hidden.rows.every((row) => row.state.correctCount === null)).toBe(true);
    expect(hidden.rows.every((row) => row.state.finalRank === null)).toBe(true);
    expect(hidden.allFinished).toBe(false);
    await expect(repository.publishFinalResults(EVENT, 3)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );

    // 총괄 운영자: 제출 전에는 공개할 수 없고, 나머지 반을 마감한 뒤 공개한다.
    await signInAsAdmin();
    await expect(repository.publishFinalResults(EVENT, 3)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(
      repository.forceCloseClassFinal({ eventId: EVENT, classId: 'g3-c2', reason: '' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    for (const classId of ['g3-c2', 'g3-c3', 'g3-c4']) {
      const closed = await repository.forceCloseClassFinal({
        eventId: EVENT,
        classId,
        reason: '시작하지 못함',
      });
      expect(closed.status).toBe('timeout');
      expect(closed.manualOverride).toBe(true);
    }
    const preview = await repository.getFinalBoard(EVENT, 3);
    expect(preview.allFinished).toBe(true);
    expect(preview.session.status).toBe('results_hidden');
    expect(preview.rows[0]).toMatchObject({ classInfo: { id: CLASS_ID } });
    expect(preview.rows[0].state).toMatchObject({ correctCount: 9, finalRank: 1 });

    const published = await repository.publishFinalResults(EVENT, 3);
    expect(published.status).toBe('results_published');

    // 공개 뒤에는 담임교사도 점수와 순위를 본다.
    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    const shown = await repository.getClassFinalView(EVENT, CLASS_ID);
    expect(shown.canViewResults).toBe(true);
    expect(shown.state).toMatchObject({ correctCount: 9, finalRank: 1 });

    // 보정: 사유가 필요하고, 공개한 뒤에 고치면 다른 반의 순위도 다시 계산된다.
    await signInAsAdmin();
    await expect(
      repository.adjustFinalResult({
        eventId: EVENT,
        classId: 'g3-c2',
        correctCount: 10,
        durationMs: null,
        finalRank: null,
        reason: '',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
    const adjusted = await repository.adjustFinalResult({
      eventId: EVENT,
      classId: 'g3-c2',
      correctCount: 10,
      durationMs: 300_000,
      finalRank: null,
      reason: '채점 입력 오류',
    });
    expect(adjusted).toMatchObject({
      correctCount: 10,
      manualOverride: true,
      overrideReason: '채점 입력 오류',
    });
    await vi.waitFor(async () => {
      const board = await repository.getFinalBoard(EVENT, 3);
      const rankOf = (classId: string) =>
        board.rows.find((row) => row.classInfo.id === classId)?.state.finalRank;
      expect(rankOf('g3-c2')).toBe(1);
      expect(rankOf(CLASS_ID)).toBe(2);
    });

    // 초기화하면 시작 전으로 돌아간다.
    const reset = await repository.resetClassFinal({
      eventId: EVENT,
      classId: CLASS_ID,
      reason: '다시 진행',
    });
    expect(reset.startedAt).toBeNull();
    const fresh = await repository.getClassFinalView(EVENT, CLASS_ID);
    expect(fresh.state.startedAt).toBeNull();
  });

  it('제한 시간이 끝나면 저장된 답안으로 마감하고 소요 시간은 제한 시간으로 기록한다', async () => {
    await prepareOpenFinal();
    // 13분 전에 시작해 1번 문제만 확정한 학급(제한 12분)
    await seedDoc(`events/${EVENT}/finalClassStates/${CLASS_ID}`, {
      classId: CLASS_ID,
      grade: 3,
      status: 'active',
      currentQuestionIndex: 1,
      completedCardTypeCountSnapshot: 1,
      allFiveCardsCompletedSnapshot: false,
      hintTotal: 1,
      hintUsed: 0,
      startedAt: new Date(Date.now() - 13 * 60_000),
      submittedAt: null,
      durationMs: null,
      correctCount: null,
      finalRank: null,
      manualOverride: false,
      overrideReason: null,
      overrideBy: null,
      questionCount: 10,
      durationLimitSec: 720,
      startRequestId: 'seed',
      updatedAt: new Date(),
    });

    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    // 시간이 끝난 뒤에는 답을 고를 수 없고 마감된다.
    const view = await repository.closeExpiredClassFinal(EVENT, CLASS_ID);
    expect(view.status).toBe('timeout');
    expect(view.state.durationMs).toBe(720_000);
    expect(view.question).toBeNull();
    await expect(
      repository.selectFinalChoice({
        eventId: EVENT,
        classId: CLASS_ID,
        questionId: 'q2',
        choiceId: 'a',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));

    // 미응답은 오답이다: 저장된 답이 없으므로 0점
    await signInAsAdmin();
    const board = await repository.getFinalBoard(EVENT, 3);
    const row = board.rows.find((item) => item.classInfo.id === CLASS_ID);
    expect(row?.status).toBe('timeout');
    expect(row?.state.correctCount).toBe(0);
  });

  it('어느 반이라도 시작한 뒤에는 제한 시간을 바꿀 수 없다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    const changed = await repository.setFinalDuration(EVENT, 3, 600);
    expect(changed.durationLimitSec).toBe(600);
    await repository.openFinal({ eventId: EVENT, grade: 3, force: true, reason: '리허설' });

    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    await repository.startClassFinal({ eventId: EVENT, classId: CLASS_ID, requestId: 'start-1' });

    await signInAsAdmin();
    await expect(repository.setFinalDuration(EVENT, 3, 900)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });

  it('최종 미션 구독은 세션과 학급 상태의 변화를 알린다', async () => {
    await prepareOpenFinal();
    await signInAs('homeroom-1', 'homeroom_teacher', { classId: CLASS_ID });
    const revisions: number[] = [];
    const stop = repository.subscribeFinal(
      EVENT,
      3,
      (revision) => revisions.push(revision),
      (error) => {
        throw error;
      },
      CLASS_ID,
    );
    await vi.waitFor(() => expect(revisions.length).toBeGreaterThan(0));
    await repository.startClassFinal({ eventId: EVENT, classId: CLASS_ID, requestId: 'start-1' });
    await vi.waitFor(() => expect(revisions[revisions.length - 1]).toBeGreaterThan(0));
    stop();
  });
});
