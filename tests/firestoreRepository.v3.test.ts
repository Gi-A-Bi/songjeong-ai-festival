import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../src/config';
import { FirestoreEventRepository } from '../src/data/firebase/FirestoreEventRepository';
import { getFirebase } from '../src/data/firebase/firebaseApp';
import { isRepositoryError } from '../src/data/errors';
import type { ClassFinalView } from '../src/data/EventRepository';
import { parseFinalQuestionUpload } from '../src/domain/finalQuestionUpload';
import { countRehearsalRecords } from '../src/domain/rehearsal';
import type { RoundNo, TeacherRole } from '../src/domain/types';
import { buildUploadFile, FIXTURE_IMAGE } from '../src/test/finalUploadFixture';

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

/**
 * 교사 문서를 넣고 로그인한다. stored에는 저장된 문서를 그대로 적는다.
 * 예전에 부스·담임으로 등록한 문서(station_teacher, homeroom_teacher와 담당)도 교사로 읽혀야 한다.
 */
async function signInAs(
  name: string,
  role: TeacherRole,
  stored: { role?: string; missionId?: string; classId?: string } = {},
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
    role: stored.role ?? role,
    active: true,
    missionId: stored.missionId ?? null,
    classId: stored.classId ?? null,
  });
  const profile = await repository.restoreTeacher();
  expect(profile?.role).toBe(role);
}

const signInAsAdmin = () => signInAs('admin', 'admin');

/** 행사 구조를 만들고 4학년을 진행 학년으로 고른다. */
async function prepareTour() {
  await signInAsAdmin();
  await repository.setupEvent(EVENT);
  await repository.setActiveGrade(EVENT, 4);
}

function booth(missionId: string, roundNo: RoundNo = 1) {
  return { eventId: EVENT, missionId, grade: 4 as const, roundNo };
}

/** 부스에서 라운드를 열고 게임을 시작한다(4학년). */
async function startGame(missionId: string, roundNo: RoundNo = 1) {
  await repository.openStationRound(booth(missionId, roundNo));
  return repository.startStationRound(booth(missionId, roundNo));
}

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
  it('라운드 열기 → 학생 체크인 → 게임 시작 → 결과 확정 → 라운드 종료가 대시보드에 나타난다', async () => {
    await prepareTour();

    // 4학년 1반 1팀은 1라운드에 1번 미션(골든벨, 시청각실)으로 간다.
    const teamId = 'g4-c1-t1';
    await signInAsStudent(teamId);
    const before = await repository.getTeamTourStatus(EVENT, teamId);
    expect(before.roundNo).toBe(1);
    expect(before.expectedMission?.id).toBe('golden-bell');
    expect(before.state?.status).toBe('scheduled');

    // 선생님이 라운드를 열기 전에는 들어갈 수 없다.
    await expect(
      repository.checkInStation({ eventId: EVENT, teamId, stationId: 'golden-bell' }),
    ).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /라운드를 열면/.test(error.message),
    );

    await signInAs('station-bell', 'teacher');
    const opened = await repository.openStationRound(booth('golden-bell'));
    expect(opened).toMatchObject({ status: 'open', startedAt: null, endsAt: null });
    expect(opened.openedAt).not.toBeNull();
    expect(Math.abs(repository.serverNow() - Date.now())).toBeLessThan(5000);
    await signInAsStudent(teamId);

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
    await signInAs('station-bell', 'teacher');
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
    expect(arrivals.booth.status).toBe('open');
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

    // 열지 않은 부스는 게임을 시작할 수 없다.
    await expect(repository.startStationRound(booth('drawing'))).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    const started = await repository.startStationRound(booth('golden-bell'));
    expect(started.status).toBe('active');
    expect(started.startedAt).not.toBeNull();
    expect(started.endsAt).toBe((started.startedAt ?? 0) + 10 * 60_000);
    const startedAgain = await repository.startStationRound(booth('golden-bell'));
    expect(startedAgain.startedAt).toBe(started.startedAt);

    await vi.waitFor(async () => {
      const current = await repository.getStationArrivals(EVENT, 'golden-bell', 4, 1);
      const statuses = current.movements.map((item) => item.status);
      // 입장한 두 팀만 진행 중이 된다.
      expect(statuses.filter((status) => status === 'active')).toHaveLength(2);
      expect(statuses.filter((status) => status === 'scheduled')).toHaveLength(3);
    });

    // 담당을 나누지 않으므로 같은 교사가 다른 부스도 진행할 수 있다.
    await expect(startGame('drawing')).resolves.toMatchObject({ status: 'active' });
    // 앞 라운드를 종료하기 전에는 다음 라운드를 열 수 없다.
    await expect(repository.openStationRound(booth('golden-bell', 2))).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    // 순위를 확정하기 전에는 라운드를 종료할 수 없다.
    await expect(repository.closeStationRound(booth('golden-bell'))).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed') && /순위를 확정/.test(error.message),
    );

    // 결과 확정 → 팀은 완료, 부스는 순위 매기는 중. 다시 확정해도 카드 보상은 늘지 않는다.
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
    await vi.waitFor(async () => {
      const ranked = await repository.getMissionRoundState(EVENT, 'golden-bell', 4, 1);
      expect(ranked).toMatchObject({ status: 'scoring', completedAt: null });
      expect(ranked.resultFinalizedAt).not.toBeNull();
    });

    // 총괄 대시보드: 골든벨은 순위를 확정했고 아직 라운드를 종료하지 않았다.
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
      expect(bell?.round.status).toBe('scoring');
      expect(bell?.teams.every((cell) => cell.state.status === 'completed')).toBe(true);
    });

    // 라운드를 종료하면 부스는 2라운드로 넘어가고 팀은 다음 교실로 이동한다.
    await signInAs('station-bell', 'teacher');
    const closed = await repository.closeStationRound(booth('golden-bell'));
    expect(closed.status).toBe('completed');
    expect(closed.completedAt).not.toBeNull();
    const closedAgain = await repository.closeStationRound(booth('golden-bell'));
    expect(closedAgain.completedAt).toBe(closed.completedAt);
    await expect(repository.openStationRound(booth('golden-bell', 2))).resolves.toMatchObject({
      status: 'open',
      roundNo: 2,
    });
    stop();

    await signInAsAdmin();
    await vi.waitFor(async () => {
      const dashboard = await repository.getOpsDashboard(EVENT, 4);
      // 부스마다 라운드가 다르다: 골든벨은 2라운드, 그리기는 1라운드.
      const rounds = Object.fromEntries(
        dashboard.stations.map((station) => [station.mission.id, station.round.roundNo]),
      );
      expect(rounds).toMatchObject({ 'golden-bell': 2, drawing: 1, ozobot: 1 });
      expect(dashboard.summary).toMatchObject({ roundNo: 1, phase: 'active' });
      const bell = dashboard.stations.find((station) => station.mission.id === 'golden-bell');
      expect(bell?.round.status).toBe('open');
      // 2라운드 골든벨에는 5팀이 온다. 1라운드를 끝낸 1팀은 틀린그림 찾기로 이동한다.
      expect(bell?.teams.map((cell) => cell.team.teamNo)).toEqual([5, 5, 5, 5, 5]);
      const moved = dashboard.classRows[0].cells.find((cell) => cell.team.id === teamId);
      expect(moved).toMatchObject({ mission: { id: 'error-hunt' }, state: { roundNo: 2 } });
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

    // 학생 기기는 다음 라운드(틀린그림 찾기)를 안내한다.
    await signInAsStudent(teamId);
    const after = await repository.getTeamTourStatus(EVENT, teamId);
    expect(after).toMatchObject({ roundNo: 2, expectedMission: { id: 'error-hunt' } });
    expect(after.state?.status).toBe('scheduled');
    const view = await repository.getTeamMissionView(EVENT, teamId, 'golden-bell');
    expect(view).toMatchObject({ roundStatus: 'closed', finalized: true });
  });

  it('라운드를 종료한 뒤 찍은 QR은 다음 라운드 입장으로 기록된다', async () => {
    await prepareTour();
    await startGame('golden-bell');
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1);
    await repository.finalizeRanking({
      ...booth('golden-bell'),
      requestId: 'finalize-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    await repository.closeStationRound(booth('golden-bell'));
    // 틀린그림 찾기 부스는 1라운드를 끝내야 2라운드를 열 수 있다.
    await startGame('error-hunt');
    const others = await repository.listMissionParticipants(EVENT, 'error-hunt', 4, 1);
    await repository.finalizeRanking({
      ...booth('error-hunt'),
      requestId: 'finalize-2',
      entries: others.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    await repository.closeStationRound(booth('error-hunt'));
    await repository.openStationRound(booth('error-hunt', 2));

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
    await prepareTour();
    await repository.openStationRound(booth('golden-bell'));

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

describe('기기 잠금 해제 (에뮬레이터)', () => {
  it('다른 팀에 묶인 기기는 교사가 잠금을 풀어야 올바른 팀으로 입장할 수 있다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);

    const wrong = 'g4-c2-t4';
    const right = 'g4-c2-t3';
    await signInAsStudent(wrong);
    await expect(repository.joinTeam(EVENT, right)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'device-locked'),
    );
    const mine = await repository.getMyDevice(EVENT);
    expect(mine.team?.id).toBe(wrong);
    expect(mine.code).toMatch(/^[0-9A-Z]{4}$/);
    // 학생은 기기 목록을 볼 수 없고 스스로 잠금을 풀 수도 없다.
    await expect(repository.listClassDevices(EVENT, 'g4-c2')).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );

    // 학생 기기의 로그인(익명 계정)을 유지한 채로는 교사가 될 수 없으므로,
    // 교사는 다른 기기에서 잠금을 푼 것으로 보고 세션 ID로 확인한다.
    const { auth } = getFirebase();
    const studentUid = auth.currentUser?.uid;
    if (!studentUid) throw new Error('학생 로그인이 없어요');

    await signInAs('homeroom-42', 'teacher');
    const devices = await repository.listClassDevices(EVENT, 'g4-c2');
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: studentUid, teamId: wrong, code: mine.code });
    expect(devices[0].joinedAt).not.toBeNull();

    await repository.unlockDevice(EVENT, studentUid);
    expect(await repository.listClassDevices(EVENT, 'g4-c2')).toHaveLength(0);
    // 이미 풀린 기기를 다시 풀어도 오류가 아니다.
    await expect(repository.unlockDevice(EVENT, studentUid)).resolves.toBeUndefined();
  });

  it('잠금이 풀린 기기는 새로 고른 팀에 다시 묶인다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await signInAsStudent('g4-c2-t4');
    const { auth } = getFirebase();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('학생 로그인이 없어요');

    // 관리자 권한으로 세션 문서를 지워 "교사가 잠금을 푼 상태"를 만든다(같은 학생 로그인 유지).
    const response = await fetch(`${DOCS}/events/${EVENT}/sessions/${uid}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer owner' },
    });
    expect(response.ok).toBe(true);

    expect((await repository.getMyDevice(EVENT)).team).toBeNull();
    const session = await repository.joinTeam(EVENT, 'g4-c2-t3');
    expect(session.teamId).toBe('g4-c2-t3');
    expect((await repository.getMyDevice(EVENT)).team?.id).toBe('g4-c2-t3');
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
    await signInAs('homeroom-1', 'teacher');
    const view = await repository.getClassFinalView(EVENT, CLASS_ID);
    expect(view.status).toBe('locked');
    await expect(
      repository.startClassFinal({ eventId: EVENT, classId: CLASS_ID, requestId: 'start-1' }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('시작 → 10문제 풀이 → 제출 → 결과 공개까지 점수는 공개 전에 교사에게 보이지 않는다', async () => {
    await prepareOpenFinal();

    await signInAs('homeroom-1', 'teacher');
    // 담당을 나누지 않으므로 어느 반이든 진행할 수 있다.
    expect((await repository.getClassFinalView(EVENT, 'g3-c2')).canRunFinal).toBe(true);

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
    await signInAs('homeroom-1', 'teacher');
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

    await signInAs('homeroom-1', 'teacher');
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

    await signInAs('homeroom-1', 'teacher');
    await repository.startClassFinal({ eventId: EVENT, classId: CLASS_ID, requestId: 'start-1' });

    await signInAsAdmin();
    await expect(repository.setFinalDuration(EVENT, 3, 900)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });

  it('최종 미션 구독은 세션과 학급 상태의 변화를 알린다', async () => {
    await prepareOpenFinal();
    await signInAs('homeroom-1', 'teacher');
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

describe('부스 화면의 제출 구독 (에뮬레이터)', () => {
  /**
   * 다른 기기의 학생이 제출한 것처럼 제출 문서를 넣는다.
   * 이 테스트는 앱 하나에 로그인이 하나뿐이라, 교사가 구독하는 동안의 학생 제출은 관리자 권한으로 흉내 낸다.
   */
  async function seedSubmission(teamId: string, classId: string) {
    const plain: Record<string, Plain> = {
      teamId,
      classId,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      status: 'submitted',
      score: null,
      reopened: false,
      requestId: `seed-${teamId}`,
      submittedAt: new Date(),
      updatedAt: new Date(),
    };
    const response = await fetch(`${DOCS}/events/${EVENT}/submissions/golden-bell__${teamId}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ...Object.fromEntries(Object.entries(plain).map(([key, value]) => [key, encode(value)])),
          answer: {
            mapValue: {
              fields: {
                type: { stringValue: 'golden_bell' },
                selections: { mapValue: { fields: { q1: { integerValue: '1' } } } },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`제출 문서 생성 실패: ${response.status}`);
  }

  it('구독하는 동안 새 제출을 알리고, 참가 팀 목록에 새로고침 없이 나타난다', async () => {
    await prepareTour();
    await startGame('golden-bell');

    // 1라운드 골든벨에는 각 반 1팀이 온다. 1반 1팀은 교사가 화면을 열기 전에 제출했다.
    await signInAsStudent('g4-c1-t1');
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId: 'g4-c1-t1',
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'before-subscribe',
    });

    await signInAs('station-bell', 'teacher');
    const submittedTeams = async (options?: { fresh?: boolean }) =>
      (await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1, options))
        .filter((participant) => participant.submission !== null)
        .map((participant) => participant.team.id)
        .sort();

    const revisions: number[] = [];
    const stop = repository.subscribeStationSubmissions(
      EVENT,
      'golden-bell',
      4,
      1,
      (revision) => revisions.push(revision),
      (error) => {
        throw error;
      },
    );
    await vi.waitFor(() => expect(revisions.length).toBeGreaterThan(0));
    expect(await submittedTeams()).toEqual(['g4-c1-t1']);

    await seedSubmission('g4-c2-t1', 'g4-c2');
    await vi.waitFor(() => expect(revisions[revisions.length - 1]).toBeGreaterThan(0));
    // 구독 캐시로 만든 목록과 서버에서 다시 읽은 목록이 같다.
    expect(await submittedTeams()).toEqual(['g4-c1-t1', 'g4-c2-t1']);
    expect(await submittedTeams({ fresh: true })).toEqual(['g4-c1-t1', 'g4-c2-t1']);

    // 자동 점수도 캐시에서 만든 목록에 채워진다.
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1);
    const late = participants.find((participant) => participant.team.id === 'g4-c2-t1');
    expect(late?.submission?.score).toBe(100);
    stop();
  });

  it('학생은 부스 제출을 구독할 수 없다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    await signInAsStudent('g4-c1-t1');
    const errors: unknown[] = [];
    const stop = repository.subscribeStationSubmissions(
      EVENT,
      'golden-bell',
      4,
      1,
      () => undefined,
      (error) => errors.push(error),
    );
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    expect(isRepositoryError(errors[0], 'not-allowed')).toBe(true);
    stop();
  });
});

describe('최종 미션 문제 올리기 (에뮬레이터)', () => {
  const CLASS_ID = 'g3-c1';

  it('총괄이 올린 문제는 담임에게 그림·유형까지 보이고, 정답은 내려가지 않으며, 연 학년은 바꿀 수 없다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    let summaries = await repository.listFinalQuestionSets(EVENT);
    expect(summaries.map((item) => item.source)).toEqual(['sample', 'sample', 'sample', 'sample']);
    expect(summaries.every((item) => item.replaceBlocker === null)).toBe(true);

    const { sets, errors } = parseFinalQuestionUpload(buildUploadFile([3, 4]));
    expect(errors).toEqual([]);
    summaries = await repository.uploadFinalQuestionSets({ eventId: EVENT, sets });
    expect(summaries.find((item) => item.grade === 3)).toMatchObject({
      source: 'upload',
      questionCount: 10,
      imageCount: 1,
    });
    expect(summaries.find((item) => item.grade === 3)?.updatedAt).toEqual(expect.any(Number));
    expect(summaries.find((item) => item.grade === 5)?.source).toBe('sample');

    // 담임은 올릴 수 없고 상태만 본다.
    await signInAs('homeroom-1', 'teacher');
    await expect(repository.uploadFinalQuestionSets({ eventId: EVENT, sets })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    expect((await repository.listFinalQuestionSets(EVENT)).length).toBe(4);

    await signInAsAdmin();
    await repository.openFinal({ eventId: EVENT, grade: 3, force: true, reason: '리허설' });
    await signInAs('homeroom-1', 'teacher');
    let view = await repository.startClassFinal({
      eventId: EVENT,
      classId: CLASS_ID,
      requestId: 'start-1',
    });
    expect(view.question).toMatchObject({
      id: 'q1',
      category: '3학년 유형 1',
      text: '3학년 1번 문제입니다.',
      image: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/answerChoiceId|hintRemoveChoiceId|explanation/);
    for (const step of [1, 2]) {
      const questionId = view.question?.id ?? '';
      await repository.selectFinalChoice({
        eventId: EVENT,
        classId: CLASS_ID,
        questionId,
        choiceId: 'b',
      });
      view = await repository.confirmFinalAnswer({
        eventId: EVENT,
        classId: CLASS_ID,
        questionId,
        requestId: `confirm-${step}`,
      });
    }
    expect(view.question).toMatchObject({
      id: 'q3',
      image: { src: FIXTURE_IMAGE, alt: '3학년 3번 그림' },
    });

    // 이미 연 학년이 끼어 있으면 아무 학년도 바꾸지 않는다.
    await signInAsAdmin();
    await expect(repository.uploadFinalQuestionSets({ eventId: EVENT, sets })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    expect(
      (await repository.listFinalQuestionSets(EVENT)).find((item) => item.grade === 4)?.source,
    ).toBe('upload');
    await repository.uploadFinalQuestionSets({
      eventId: EVENT,
      sets: parseFinalQuestionUpload(buildUploadFile([5])).sets,
    });
    expect(
      (await repository.listFinalQuestionSets(EVENT)).find((item) => item.grade === 5)?.source,
    ).toBe('upload');
  });
});

describe('예전 역할로 등록된 교사 (에뮬레이터)', () => {
  it('부스·담임으로 등록했던 계정도 교사로 읽히고 어느 부스와 학급이든 맡을 수 있다', async () => {
    await prepareTour();

    await signInAs('legacy-booth', 'teacher', { role: 'station_teacher', missionId: 'drawing' });
    await expect(startGame('ozobot')).resolves.toMatchObject({ status: 'active' });

    await signInAs('legacy-homeroom', 'teacher', { role: 'homeroom_teacher', classId: 'g4-c2' });
    await expect(startGame('drawing')).resolves.toMatchObject({ status: 'active' });
    expect((await repository.getClassFinalView(EVENT, 'g4-c1')).canRunFinal).toBe(true);
    // 진행 학년과 게임 시간은 총괄만 바꾼다.
    await expect(repository.setActiveGrade(EVENT, 5)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(repository.setGameDuration(EVENT, 8)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });
});

describe('연습 기록 지우기 (에뮬레이터)', () => {
  it('총괄이 한 학년의 기록을 지우면 처음 상태가 되고, 다른 학년과 행사 구조는 남는다', async () => {
    await prepareTour();
    await repository.setGameDuration(EVENT, 8);
    await startGame('golden-bell');

    // 4학년 1반 1팀이 입장하고 제출한다.
    const teamId = 'g4-c1-t1';
    await signInAsStudent(teamId);
    await repository.checkInStation({ eventId: EVENT, teamId, stationId: 'golden-bell' });
    await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'rehearsal-1',
    });

    await signInAsAdmin();
    await repository.setAnswerRevealed(EVENT, 'golden-bell', 4, 1, true);
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 1);
    await repository.finalizeRanking({
      ...booth('golden-bell'),
      requestId: 'rehearsal-finalize',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    await repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: '연습' });
    await repository.setFinalDuration(EVENT, 3, 600);
    // 다른 학년(3학년)의 기록
    await seedCompletedCard('g3-c1', 3);

    const before = await repository.getRehearsalSummary(EVENT, 4);
    expect(before.counts).toEqual({
      submissions: 1,
      results: 5,
      cardAwards: 5,
      checkIns: 1,
      boothRounds: 1,
      finalClasses: 0,
      devices: 1,
    });
    expect(before.finalOpened).toBe(true);
    expect(await repository.listClassDevices(EVENT, 'g4-c1')).toHaveLength(1);

    // 교사는 기록을 보거나 지울 수 없다.
    await signInAs('station-bell', 'teacher');
    await expect(repository.getRehearsalSummary(EVENT, 4)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(repository.resetRehearsal({ eventId: EVENT, grade: 4 })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );

    await signInAsAdmin();
    const after = await repository.resetRehearsal({ eventId: EVENT, grade: 4 });
    expect(countRehearsalRecords(after.counts)).toBe(0);
    expect(after.finalOpened).toBe(false);

    // 다른 학년의 기록과 설정은 그대로다.
    const other = await repository.getRehearsalSummary(EVENT, 3);
    expect(other.counts.cardAwards).toBe(4);
    expect((await repository.getFinalBoard(EVENT, 3)).session.durationLimitSec).toBe(600);

    // 행사 구조, 미션 문제, 진행 학년, 게임 시간은 남는다.
    expect(await repository.listClasses(EVENT, 4)).toHaveLength(5);
    expect(await repository.listTeams(EVENT, 4)).toHaveLength(25);
    expect((await repository.listMissions(EVENT)).length).toBe(5);
    expect(await repository.getEvent(EVENT)).toMatchObject({
      activeGrade: 4,
      gameDurationMs: 8 * 60_000,
    });
    expect(
      (await repository.listFinalQuestionSets(EVENT)).every((item) => item.questionCount === 10),
    ).toBe(true);

    // 부스는 1라운드를 열기 전으로, 최종 미션은 열기 전으로 돌아간다.
    await vi.waitFor(async () => {
      const rounds = await repository.getStationRounds(EVENT, 'golden-bell', 4);
      expect(rounds.map((round) => round.status)).toEqual([
        'ready',
        'ready',
        'ready',
        'ready',
        'ready',
      ]);
    });
    expect(await repository.isAnswerRevealed(EVENT, 'golden-bell', 4, 1)).toBe(false);
    expect((await repository.getFinalBoard(EVENT, 4)).session.status).toBe('locked');
    expect(await repository.listClassDevices(EVENT, 'g4-c1')).toHaveLength(0);
    await vi.waitFor(async () => {
      const dashboard = await repository.getOpsDashboard(EVENT, 4);
      expect(dashboard.summary).toMatchObject({
        roundNo: 0,
        phase: 'ready',
        checkedInTeams: 0,
        completedTeams: 0,
      });
    });

    // 지운 뒤에 다시 1라운드부터 진행하고 제출할 수 있다.
    await expect(startGame('golden-bell')).resolves.toMatchObject({ status: 'active' });
    await signInAsStudent(teamId);
    const tour = await repository.getTeamTourStatus(EVENT, teamId);
    expect(tour).toMatchObject({ roundNo: 1, state: { checkedInAt: null } });
    const again = await repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'event-day-1',
    });
    expect(again.status).toBe('submitted');
  });

  it('기록이 없는 학년을 지워도 오류가 나지 않는다', async () => {
    await signInAsAdmin();
    await repository.setupEvent(EVENT);
    const summary = await repository.resetRehearsal({ eventId: EVENT, grade: 6 });
    expect(countRehearsalRecords(summary.counts)).toBe(0);
    expect(summary.finalOpened).toBe(false);
  });
});
