import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../src/config';
import { FirestoreEventRepository } from '../src/data/firebase/FirestoreEventRepository';
import { getFirebase } from '../src/data/firebase/firebaseApp';
import { isRepositoryError } from '../src/data/errors';
import type { MissionLiveState } from '../src/data/EventRepository';
import type { FestivalEvent } from '../src/domain/types';

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

beforeAll(async () => {
  repository = new FirestoreEventRepository();
});

beforeEach(async () => {
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

  it('교사가 라운드를 시작하면 구독 중인 화면에 바뀐 상태가 전달된다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);

    const updates: FestivalEvent[] = [];
    const stop = repository.subscribeEvent(
      DEFAULT_EVENT_ID,
      (event) => updates.push(event),
      (error) => {
        throw error;
      },
    );
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));

    await repository.controlRound(DEFAULT_EVENT_ID, 'start');
    await vi.waitFor(() => {
      const latest = updates[updates.length - 1];
      expect(latest.status).toBe('active');
      expect(latest.activeRound).toBe(1);
      expect(latest.roundEndsAt).not.toBeNull();
    });

    await repository.controlRound(DEFAULT_EVENT_ID, 'pause');
    await vi.waitFor(() => {
      const latest = updates[updates.length - 1];
      expect(latest.status).toBe('paused');
      expect(latest.pausedRemainingMs).toBeGreaterThan(0);
    });
    stop();
  });

  it('학생은 자기 팀으로 입장해 한 번만 제출할 수 있다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

    await signInAsStudent();
    const session = await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    expect(session.teamId).toBe(TEAM_ID);

    const view = await repository.getTeamMissionView(DEFAULT_EVENT_ID, TEAM_ID, 'golden-bell');
    expect(view.roundNo).toBe(1);
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
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

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

  it('지금 라운드가 아닌 미션은 제출할 수 없다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
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
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

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

  it('교사가 재제출을 허용하면 라운드가 끝난 뒤에도 다시 제출하고, 학생 화면에 알림이 간다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

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
    await repository.controlRound(DEFAULT_EVENT_ID, 'end');
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

    // 라운드가 끝났어도 재제출은 받는다.
    const again = await repository.saveSubmission({
      ...input,
      answer: { type: 'golden_bell', selections: { q1: 1 } },
      requestId: 'second',
    });
    expect(again.status).toBe('submitted');
    expect(again.score).toBe(100);
  });

  it('확정한 순위를 고치면 고르기 전 카드 보상의 후보 수가 새 순위에 맞춰진다', async () => {
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');
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
    await signInAsTeacher();
    await repository.setupEvent(DEFAULT_EVENT_ID);
    await repository.setActiveGrade(DEFAULT_EVENT_ID, 4);
    await repository.controlRound(DEFAULT_EVENT_ID, 'start');

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
        strokeCount: 3,
        mimeType: 'image/webp',
        byteSize: bytes.length,
        width: 960,
        height: 540,
      },
      requestId: 'drawing-1',
      drawing: {
        promptId: 'draw-sample-1',
        mimeType: 'image/webp',
        width: 960,
        height: 540,
        bytes,
      },
    });

    await signInAsTeacher();
    const files = await repository.listDrawingFiles(DEFAULT_EVENT_ID, 'drawing', 4, 1);
    expect(files).toHaveLength(1);
    expect(files[0].teamId).toBe(drawingTeam);
    expect(Array.from(files[0].bytes)).toEqual(Array.from(bytes));
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
});
