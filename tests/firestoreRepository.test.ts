import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../src/config';
import { FirestoreEventRepository } from '../src/data/firebase/FirestoreEventRepository';
import { getFirebase } from '../src/data/firebase/firebaseApp';
import { isRepositoryError } from '../src/data/errors';
import type { MissionLiveState } from '../src/data/EventRepository';
import { resolveDrawingPrompt } from '../src/domain/drawingPrompts';
import { getGoldenBellQuestions } from '../src/domain/goldenBell';
import { applyGoldenBellUpload, parseGoldenBellUpload } from '../src/domain/goldenBellUpload';
import { createGoldenUploadFixture } from '../src/test/goldenUploadFixture';
import type { FestivalEvent, RoundNo } from '../src/domain/types';

const PROJECT_ID = 'demo-songjeong';
const FIRESTORE_HOST = 'http://127.0.0.1:8080';
const AUTH_HOST = 'http://127.0.0.1:9099';
const TEACHER_EMAIL = 'teacher@songjeong.test';
const TEACHER_PASSWORD = 'test-password';
const TEAM_ID = 'g4-c1-t1';

let repository: FirestoreEventRepository;

async function clearEmulators() {
  await fetch(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    {
      method: 'DELETE',
    },
  );
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

/** teachers 문서는 보안 규칙이 클라이언트 쓰기를 막으므로 관리자 권한(REST)으로 넣는다. */
async function registerTeacher(uid: string) {
  const response = await fetch(
    `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/teachers/${uid}`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          displayName: { stringValue: '테스트 교사' },
          email: { stringValue: TEACHER_EMAIL },
          role: { stringValue: 'admin' },
          active: { booleanValue: true },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`teachers 문서 생성 실패: ${response.status}`);
}

async function signInAsTeacher() {
  const { auth } = getFirebase();
  await signOut(auth).catch(() => undefined);
  try {
    await signInWithEmailAndPassword(auth, TEACHER_EMAIL, TEACHER_PASSWORD);
  } catch {
    await createUserWithEmailAndPassword(auth, TEACHER_EMAIL, TEACHER_PASSWORD);
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('교사 로그인 실패');
  await registerTeacher(uid);
  const profile = await repository.restoreTeacher();
  expect(profile?.role).toBe('admin');
}

async function signInAsStudent() {
  await repository.signOutTeacher();
}

/** 행사 구조를 만들고 4학년을 진행 학년으로 고른다. */
async function prepareTour() {
  await signInAsTeacher();
  await repository.setupEvent(DEFAULT_EVENT_ID);
  await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
}

/** 부스에서 라운드를 열고 게임을 시작한다(4학년). */
async function startGame(missionId: string, roundNo: RoundNo = 1) {
  const input = { eventId: DEFAULT_EVENT_ID, missionId, grade: 4 as const, roundNo };
  await repository.openStationRound(input);
  return repository.startStationRound(input);
}

/** 게임을 11분 전에 시작한 것으로 바꿔 게임 시간(10분)이 끝난 상태를 만든다. */
async function endGameTime(missionId: string, roundNo: RoundNo = 1) {
  const { db } = getFirebase();
  await setDoc(
    doc(db, 'events', DEFAULT_EVENT_ID, 'missionRoundStates', `${missionId}_g4_r${roundNo}`),
    { startedAt: Timestamp.fromMillis(Date.now() - 11 * 60_000) },
    { merge: true },
  );
}

async function finalize(missionId: string, roundNo: RoundNo = 1) {
  const participants = await repository.listMissionParticipants(
    DEFAULT_EVENT_ID,
    missionId,
    4,
    roundNo,
  );
  return repository.finalizeRanking({
    eventId: DEFAULT_EVENT_ID,
    missionId,
    grade: 4,
    roundNo,
    requestId: `finalize-${missionId}-${roundNo}`,
    entries: participants.map((participant, index) => ({
      teamId: participant.team.id,
      score: 500 - index * 100,
      rank: index + 1,
    })),
  });
}

beforeAll(async () => {
  repository = new FirestoreEventRepository();
});

beforeEach(async () => {
  // 앞 테스트의 구독을 끊고 시작한다.
  await repository.signOutTeacher();
  await clearEmulators();
});

describe('FirestoreEventRepository (에뮬레이터)', () => {
  it('교사는 행사 구조를 만들고, 이미 있으면 다시 만들지 않는다', async () => {
    await signInAsTeacher();
    const created = await repository.setupEvent(DEFAULT_EVENT_ID);
    expect(created).toEqual({ created: true, classes: 20, teams: 100, missions: 5 });

    const again = await repository.setupEvent(DEFAULT_EVENT_ID);
    expect(again).toEqual({ created: false, classes: 20, teams: 100, missions: 5 });
  });

  it('총괄이 진행 학년과 게임 시간을 바꾸면 구독 중인 화면에 전달된다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);

    const updates: FestivalEvent[] = [];
    const stop = repository.subscribeEvent(
      DEFAULT_EVENT_ID,
      (event) => updates.push(event),
      (error) => {
        throw error;
      },
    );
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    // 기본 게임 시간은 10분이고, 전체 행사 상태에는 라운드가 없다.
    expect(updates[0]).toMatchObject({
      status: 'ready',
      activeGrade: null,
      activeRound: 0,
      gameDurationMs: 10 * 60_000,
    });

    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.setGameDuration(DEFAULT_EVENT_ID, 8);
    await vi.waitFor(() => {
      expect(updates[updates.length - 1]).toMatchObject({
        status: 'active',
        activeGrade: 4,
        activeRound: 0,
        gameDurationMs: 8 * 60_000,
      });
    });
    await expect(repository.setGameDuration(DEFAULT_EVENT_ID, 2)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'invalid-input'),
    );
    stop();
  });

  it('부스가 라운드를 열고 게임을 시작하고 종료하면 그 부스에 오는 팀의 화면에 전달된다', async () => {
    await prepareTour();
    const booth = { eventId: DEFAULT_EVENT_ID, missionId: 'golden-bell', grade: 4 as const };

    // 4학년 1반 1팀은 1라운드에 골든벨, 2라운드에 틀린그림 찾기로 간다.
    const updates: FestivalEvent[] = [];
    const stop = repository.subscribeTeamEvent(
      DEFAULT_EVENT_ID,
      TEAM_ID,
      (event) => updates.push(event),
      (error) => {
        throw error;
      },
    );
    const latest = () => updates[updates.length - 1];
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(latest()).toMatchObject({ status: 'ready', activeRound: 0, boothStatus: 'ready' });

    // 다른 팀이 가는 부스가 바뀌어도 이 팀의 상태는 그대로다.
    await repository.openStationRound({ ...booth, missionId: 'drawing', roundNo: 1 });
    await repository.openStationRound({ ...booth, roundNo: 1 });
    await vi.waitFor(() => expect(latest().boothStatus).toBe('open'));
    expect(latest()).toMatchObject({ status: 'ready', activeRound: 0 });

    const started = await repository.startStationRound({ ...booth, roundNo: 1 });
    expect(started.status).toBe('active');
    await vi.waitFor(() => expect(latest().status).toBe('active'));
    expect(latest()).toMatchObject({ activeRound: 1, boothStatus: 'active' });
    // 게임은 시작한 때부터 10분이다.
    const endsAt = latest().roundEndsAt ?? 0;
    expect(Math.abs(endsAt - (Date.now() + 10 * 60_000))).toBeLessThan(10_000);

    // 순위를 확정하기 전에는 종료할 수 없다.
    await expect(repository.closeStationRound({ ...booth, roundNo: 1 })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
    await finalize('golden-bell');
    await vi.waitFor(() => expect(latest().boothStatus).toBe('scoring'));

    const closed = await repository.closeStationRound({ ...booth, roundNo: 1 });
    expect(closed.status).toBe('completed');
    // 종료하면 다음 부스(틀린그림 찾기 2라운드)를 기다린다.
    await vi.waitFor(() =>
      expect(latest()).toMatchObject({ status: 'ready', activeRound: 1, boothStatus: 'ready' }),
    );
    stop();

    const rounds = await repository.getStationRounds(DEFAULT_EVENT_ID, 'golden-bell', 4);
    expect(rounds.map((round) => round.status)).toEqual([
      'completed',
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
  });

  it('게임 시간이 끝나면 구독 중인 팀 화면이 스스로 채점 단계로 바뀐다', async () => {
    await prepareTour();
    await startGame('golden-bell');
    // 게임이 끝나기 1초 전으로 맞춘다.
    const { db } = getFirebase();
    await setDoc(
      doc(db, 'events', DEFAULT_EVENT_ID, 'missionRoundStates', 'golden-bell_g4_r1'),
      { startedAt: Timestamp.fromMillis(Date.now() - 10 * 60_000 + 1000) },
      { merge: true },
    );

    const updates: FestivalEvent[] = [];
    const stop = repository.subscribeTeamEvent(
      DEFAULT_EVENT_ID,
      TEAM_ID,
      (event) => updates.push(event),
      (error) => {
        throw error;
      },
    );
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    await vi.waitFor(
      () => expect(updates[updates.length - 1]).toMatchObject({ boothStatus: 'scoring' }),
      { timeout: 5000 },
    );
    stop();
  });

  it('종료하지 않은 부스 라운드가 있으면 진행 학년을 바꿀 수 없다', async () => {
    await prepareTour();
    await startGame('golden-bell');
    await expect(repository.setActiveGrade(DEFAULT_EVENT_ID, 5)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await finalize('golden-bell');
    await repository.closeStationRound({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
    });
    await expect(repository.setActiveGrade(DEFAULT_EVENT_ID, 5)).resolves.toMatchObject({
      activeGrade: 5,
    });
  });

  it('학생은 자기 팀으로 입장해 한 번만 제출할 수 있다', async () => {
    await prepareTour();
    await startGame('golden-bell');

    await signInAsStudent();
    const session = await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    expect(session.teamId).toBe(TEAM_ID);

    const view = await repository.getTeamMissionView(DEFAULT_EVENT_ID, TEAM_ID, 'golden-bell');
    expect(view.roundNo).toBe(1);
    expect(view.roundStatus).toBe('active');
    expect(view.booth).toMatchObject({ status: 'active', roundNo: 1 });
    expect(view.submission).toBeNull();

    const saved = await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'submit-1',
    });
    expect(saved.status).toBe('submitted');
    expect(saved.score).toBe(100);

    // 같은 요청 재시도는 그대로, 새 요청은 거부
    const retry = await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'submit-1',
    });
    expect(retry.id).toBe(saved.id);
    await expect(
      repository.saveSubmission({
        eventId: DEFAULT_EVENT_ID,
        missionId: 'golden-bell',
        teamId: TEAM_ID,
        answer: { type: 'golden_bell', selections: { q1: 2 } },
        requestId: 'submit-2',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('순위 확정으로 팀마다 카드 보상이 하나씩 생기고, 한 번만 받을 수 있다', async () => {
    await prepareTour();
    await startGame('golden-bell');

    const participants = await repository.listMissionParticipants(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      1,
    );
    expect(participants).toHaveLength(5);

    const outcome = await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    });
    expect(outcome.awards.map((award) => award.offeredTypes.length)).toEqual([3, 2, 1, 1, 1]);

    // 다시 확정해도 보상이 늘지 않는다
    const again = await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-2',
      entries: [],
    });
    expect(again.alreadyFinalized).toBe(true);
    expect(again.awards).toHaveLength(5);

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const view = await repository.getTeamRewardView(DEFAULT_EVENT_ID, TEAM_ID);
    const pending = view.awards.find((award) => award.status === 'pending');
    if (!pending) throw new Error('고르기 전 보상이 없어요');
    expect(pending.offeredTypes).toHaveLength(3);

    const outside = (
      ['thinking', 'observation', 'expression', 'command', 'verification'] as const
    ).find((cardType) => !pending.offeredTypes.includes(cardType));
    if (!outside) throw new Error('후보 밖 종류가 없어요');
    await expect(
      repository.claimCardAward({
        eventId: DEFAULT_EVENT_ID,
        teamId: TEAM_ID,
        awardId: pending.id,
        selectedType: outside,
        requestId: 'claim-outside',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error));

    const selectedType = pending.offeredTypes[0];
    const claim = {
      eventId: DEFAULT_EVENT_ID,
      teamId: TEAM_ID,
      awardId: pending.id,
      selectedType,
      requestId: 'claim-1',
    };
    const claimed = await repository.claimCardAward(claim);
    expect(claimed.after.earned).toBe(claimed.before.earned + 1);
    // 같은 요청을 다시 보내면 같은 결과, 다른 요청은 거부
    await expect(repository.claimCardAward(claim)).resolves.toBeTruthy();
    await expect(repository.claimCardAward({ ...claim, requestId: 'claim-2' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'already-claimed'),
    );

    const boards = await repository.listClassCardBoards(DEFAULT_EVENT_ID, 4);
    const classBoard = boards.find((board) => board.classInfo.id === 'g4-c1');
    expect(classBoard?.progress.cards[selectedType].earned).toBe(claimed.after.earned);
  });

  it('게임을 시작하지 않은 부스와 게임 시간이 끝난 부스는 제출을 받지 않는다', async () => {
    await prepareTour();
    await repository.openStationRound({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
    });

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const bell = {
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: { type: 'golden_bell' as const, selections: { q1: 1 } },
    };
    // 라운드만 열었을 때
    await expect(repository.saveSubmission({ ...bell, requestId: 'too-early' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );

    await signInAsTeacher();
    await repository.startStationRound({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
    });
    await endGameTime('golden-bell');
    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    // 게임 시간이 끝난 뒤
    await expect(repository.saveSubmission({ ...bell, requestId: 'too-late' })).rejects.toSatisfy(
      (error) =>
        isRepositoryError(error, 'not-allowed') && /게임 시간이 끝났어요/.test(error.message),
    );
    // 1팀의 오류찾기(5번 미션)는 5라운드 미션이다.
    await expect(
      repository.saveSubmission({
        eventId: DEFAULT_EVENT_ID,
        missionId: 'library-check',
        teamId: TEAM_ID,
        answer: {
          type: 'library_check',
          wrongPart: '다리 8개',
          correction: '다리 6개',
          bookTitle: '곤충 백과',
          page: 12,
        },
        requestId: 'early-1',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('교사 화면은 자동 채점 점수를 계산해 보여 준다', async () => {
    await prepareTour();
    await startGame('golden-bell');

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      // 샘플 1·2번 문제는 정답, 3번은 오답
      answer: { type: 'golden_bell', selections: { q1: 1, q2: 2, q3: 3 } },
      requestId: 'score-1',
    });

    await signInAsTeacher();
    const participants = await repository.listMissionParticipants(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      1,
    );
    const row = participants.find((participant) => participant.team.id === TEAM_ID);
    expect(row?.submission?.score).toBe(200);
  });

  it('교사가 재제출을 허용하면 게임 시간이 끝난 뒤에도 다시 제출하고, 학생 화면에 알림이 간다', async () => {
    await prepareTour();
    await startGame('golden-bell');

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const input = {
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: { type: 'golden_bell' as const, selections: { q1: 0 } },
      requestId: 'first',
    };
    await repository.saveSubmission(input);

    await signInAsTeacher();
    const states: MissionLiveState[] = [];
    const stop = repository.subscribeMissionState(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      1,
      (state) => states.push(state),
      () => undefined,
    );
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));
    await endGameTime('golden-bell');
    await repository.reopenSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
    });
    await vi.waitFor(() => expect(states[states.length - 1].updatedAt).toBeGreaterThan(0));
    stop();

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const view = await repository.getTeamMissionView(DEFAULT_EVENT_ID, TEAM_ID, 'golden-bell');
    expect(view.submission?.status).toBe('draft');
    expect(view.submission?.reopened).toBe(true);

    // 게임 시간이 끝났어도 재제출은 받는다.
    expect(view.roundStatus).toBe('scoring');
    const again = await repository.saveSubmission({
      ...input,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'second',
    });
    expect(again.status).toBe('submitted');
    expect(again.score).toBe(100);
  });

  it('확정한 순위를 고치면 고르기 전 카드 보상의 후보 수가 새 순위에 맞춰진다', async () => {
    await prepareTour();
    await startGame('golden-bell');
    const participants = await repository.listMissionParticipants(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      1,
    );
    const base = {
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 1 as const,
    };
    await repository.finalizeRanking({
      ...base,
      requestId: 'finalize-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    });

    const outcome = await repository.reviseRanking({
      ...base,
      requestId: 'revise-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 500 - index * 100,
        // 1위와 2위를 바꾼다.
        rank: index === 0 ? 2 : index === 1 ? 1 : index + 1,
      })),
    });
    expect(outcome).toMatchObject({ reoffered: 2, keptClaimed: 0 });

    const after = await repository.listMissionParticipants(DEFAULT_EVENT_ID, 'golden-bell', 4, 1);
    expect(after[0].award?.offeredTypes).toHaveLength(2);
    expect(after[1].award?.offeredTypes).toHaveLength(3);
    expect(after[0].result?.rank).toBe(2);
  });

  it('그림 파일은 제출과 함께 저장되고 교사가 불러올 수 있다', async () => {
    await prepareTour();
    await startGame('drawing');

    // 3팀은 1라운드에 그리기 미션을 한다.
    const drawingTeam = 'g4-c1-t3';
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, drawingTeam);
    await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'drawing',
      teamId: drawingTeam,
      answer: {
        type: 'drawing',
        promptId: 'starry-night',
        mimeType: 'image/webp',
        byteSize: bytes.length,
        width: 960,
        height: 720,
      },
      requestId: 'drawing-1',
      drawing: {
        promptId: 'starry-night',
        mimeType: 'image/webp',
        width: 960,
        height: 720,
        bytes,
      },
    });

    await signInAsTeacher();
    const files = await repository.listDrawingFiles(DEFAULT_EVENT_ID, 'drawing', 4, 1);
    expect(files).toHaveLength(1);
    expect(files[0].teamId).toBe(drawingTeam);
    expect(Array.from(files[0].bytes)).toEqual(Array.from(bytes));
  });

  it('교사는 학년별 그림 프롬프트를 고르고, 학생은 자기 학년의 프롬프트를 받는다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'drawing');
    if (mission.config.type !== 'drawing') throw new Error('그리기 미션이 아니에요');
    expect(mission.config.prompts).toHaveLength(4);

    await repository.updateMissionConfig(DEFAULT_EVENT_ID, 'drawing', {
      ...mission.config,
      selectedPromptIds: { 4: 'gleaners' },
    });
    await expect(
      repository.updateMissionConfig(DEFAULT_EVENT_ID, 'drawing', {
        ...mission.config,
        selectedPromptIds: { 4: 'ssireum' },
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, 'g4-c1-t3');
    const view = await repository.getTeamMissionView(DEFAULT_EVENT_ID, 'g4-c1-t3', 'drawing');
    if (view.mission.config.type !== 'drawing') throw new Error('그리기 미션이 아니에요');
    expect(resolveDrawingPrompt(view.mission.config, 4)?.id).toBe('gleaners');
    expect(resolveDrawingPrompt(view.mission.config, 5)?.id).toBe('ssireum');
  });

  it('교사는 골든벨 문제를 등록하고, 잘못된 문제는 저장하지 않는다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    const questions = [
      {
        id: 'new-1',
        question: 'AI는 틀릴 수 있을까요?',
        choices: ['예', '아니요'],
        answerIndex: 0,
        explanation: 'AI도 틀릴 수 있어요.',
      },
    ];
    await repository.updateMissionConfig(DEFAULT_EVENT_ID, 'golden-bell', {
      type: 'golden_bell',
      questions,
    });
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'golden-bell');
    expect(mission.config).toEqual({ type: 'golden_bell', questions });

    await expect(
      repository.updateMissionConfig(DEFAULT_EVENT_ID, 'golden-bell', {
        type: 'golden_bell',
        questions: [],
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'invalid-input'));
  });

  it('골든벨 문제 파일을 올리면 학년별 문제가 저장되고, 학생의 O/X·객관식·단답형 답을 채점한다', async () => {
    await prepareTour();
    const before = await repository.getMission(DEFAULT_EVENT_ID, 'golden-bell');
    if (before.config.type !== 'golden_bell') throw new Error('골든벨 미션이 아니에요');

    // 예시 파일의 3학년 묶음을 4학년 문제로 바꿔 올린다(진행 학년이 4학년이다).
    const raw = createGoldenUploadFixture();
    raw.sets[0].grades = [4];
    const { sets, errors } = parseGoldenBellUpload(raw);
    expect(errors).toEqual([]);
    await repository.updateMissionConfig(
      DEFAULT_EVENT_ID,
      'golden-bell',
      applyGoldenBellUpload(before.config, sets),
    );

    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'golden-bell');
    if (mission.config.type !== 'golden_bell') throw new Error('골든벨 미션이 아니에요');
    expect(getGoldenBellQuestions(mission.config, 4)).toEqual(sets[0].questions);
    expect(getGoldenBellQuestions(mission.config, 5)).toEqual(sets[1].questions);
    expect(getGoldenBellQuestions(mission.config, 6)).toEqual(sets[1].questions);
    // 파일에 없는 3학년은 공통 문제를 그대로 쓴다.
    expect(getGoldenBellQuestions(mission.config, 3)).toEqual(before.config.questions);

    await startGame('golden-bell');
    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const view = await repository.getTeamMissionView(DEFAULT_EVENT_ID, TEAM_ID, 'golden-bell');
    if (view.mission.config.type !== 'golden_bell') throw new Error('골든벨 미션이 아니에요');
    expect(getGoldenBellQuestions(view.mission.config, view.team.grade)).toHaveLength(3);

    const [ox, choice, short] = sets[0].questions;
    const saved = await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: {
        type: 'golden_bell',
        selections: { [ox.id]: 0, [choice.id]: 0 },
        // 띄어쓰기와 대소문자가 달라도 맞게 채점한다.
        texts: { [short.id]: ' key board ' },
      },
      requestId: 'golden-kinds',
    });
    expect(saved.score).toBe(200);
    expect(saved.answer).toEqual({
      type: 'golden_bell',
      selections: { [ox.id]: 0, [choice.id]: 0 },
      texts: { [short.id]: ' key board ' },
    });
  });
});

/** 에뮬레이터의 가짜 Google 로그인. 실제 Google 로그인처럼 확인된 이메일이 토큰에 들어간다. */
async function signInWithGoogle(sub: string, email: string, name: string) {
  const { auth } = getFirebase();
  await repository.signOutTeacher();
  const idToken = JSON.stringify({ sub, email, email_verified: true, name });
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  return user;
}

describe('이메일로 교사 등록 (에뮬레이터)', () => {
  it('총괄이 등록한 이메일의 Google 계정은 처음 로그인할 때 그 역할의 교사가 된다', async () => {
    await signInAsTeacher();
    const registry = await repository.saveTeacherInvites({
      emails: ['new.teacher@example.com', 'head@example.com'],
      role: 'teacher',
    });
    expect(registry.invites).toEqual([
      expect.objectContaining({ email: 'head@example.com', role: 'teacher' }),
      expect.objectContaining({ email: 'new.teacher@example.com', role: 'teacher' }),
    ]);

    // Google 계정의 이메일에 대문자가 섞여 있어도 등록한 이메일로 알아본다.
    const user = await signInWithGoogle('google-1', 'New.Teacher@example.com', '새 선생님');
    const profile = await repository.restoreTeacher();
    expect(profile).toEqual({ uid: user.uid, displayName: '새 선생님', role: 'teacher' });
    // 교사는 담당을 나누지 않고 어느 부스의 설정이든 고칠 수 있다.
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await signInWithGoogle('google-1', 'New.Teacher@example.com', '새 선생님');
    await repository.restoreTeacher();
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'drawing');
    await expect(
      repository.updateMissionConfig(DEFAULT_EVENT_ID, 'drawing', mission.config),
    ).resolves.toBeTruthy();

    // 다시 로그인해도 같은 교사다.
    await signInWithGoogle('google-1', 'New.Teacher@example.com', '새 선생님');
    expect((await repository.restoreTeacher())?.uid).toBe(user.uid);
  });

  it('등록되지 않은 Google 계정은 교사가 될 수 없고 등록 기능도 쓸 수 없다', async () => {
    await signInAsTeacher();
    await repository.saveTeacherInvites({
      emails: ['new.teacher@example.com'],
      role: 'admin',
    });

    await signInWithGoogle('google-2', 'stranger@example.com', '모르는 사람');
    expect(await repository.restoreTeacher()).toBeNull();
    await expect(repository.getTeacherRegistry()).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(
      repository.saveTeacherInvites({
        emails: ['stranger@example.com'],
        role: 'admin',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('총괄로 등록된 계정은 다른 교사를 등록할 수 있다', async () => {
    await signInAsTeacher();
    await repository.saveTeacherInvites({
      emails: ['head@example.com'],
      role: 'admin',
    });

    await signInWithGoogle('google-3', 'head@example.com', '새 총괄');
    expect((await repository.restoreTeacher())?.role).toBe('admin');
    const registry = await repository.saveTeacherInvites({
      emails: ['homeroom@example.com'],
      role: 'teacher',
    });
    expect(registry.invites.map((item) => item.email)).toContain('homeroom@example.com');
    expect(registry.accounts.map((item) => item.email)).toContain('head@example.com');
  });

  it('등록을 취소한 이메일은 로그인해도 교사가 되지 않는다', async () => {
    await signInAsTeacher();
    await repository.saveTeacherInvites({
      emails: ['new.teacher@example.com'],
      role: 'teacher',
    });
    const registry = await repository.deleteTeacherInvite('new.teacher@example.com');
    expect(registry.invites).toEqual([]);

    await signInWithGoogle('google-1', 'new.teacher@example.com', '새 선생님');
    expect(await repository.restoreTeacher()).toBeNull();
  });

  it('사용 중지한 계정은 교사 화면을 쓸 수 없고, 다시 사용하게 하면 돌아온다', async () => {
    await signInAsTeacher();
    await repository.saveTeacherInvites({
      emails: ['new.teacher@example.com'],
      role: 'teacher',
    });
    const user = await signInWithGoogle('google-1', 'new.teacher@example.com', '새 선생님');
    expect(await repository.restoreTeacher()).not.toBeNull();

    await signInAsTeacher();
    const stopped = await repository.setTeacherActive(user.uid, false);
    expect(stopped.accounts.find((item) => item.uid === user.uid)?.active).toBe(false);
    const admin = repository.getCurrentTeacher();
    await expect(repository.setTeacherActive(admin?.uid ?? '', false)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );

    // 초대장이 남아 있어도 사용 중지된 계정은 다시 등록되지 않는다.
    await signInWithGoogle('google-1', 'new.teacher@example.com', '새 선생님');
    expect(await repository.restoreTeacher()).toBeNull();

    await signInAsTeacher();
    await repository.setTeacherActive(user.uid, true);
    await signInWithGoogle('google-1', 'new.teacher@example.com', '새 선생님');
    expect((await repository.restoreTeacher())?.role).toBe('teacher');
  });

  it('이메일이 없으면 등록하지 않는다', async () => {
    await signInAsTeacher();
    await expect(repository.saveTeacherInvites({ emails: [], role: 'admin' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'invalid-input'),
    );
    expect((await repository.getTeacherRegistry()).invites).toEqual([]);
  });
});
