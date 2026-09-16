import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../src/config';
import { FirestoreEventRepository } from '../src/data/firebase/FirestoreEventRepository';
import { getFirebase } from '../src/data/firebase/firebaseApp';
import { isRepositoryError } from '../src/data/errors';
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
      answer: { type: 'golden_bell', choiceIndex: 1 },
      requestId: 'submit-1',
    });
    expect(saved.status).toBe('submitted');
    expect(saved.score).toBe(100);

    // 같은 요청 재시도는 그대로, 새 요청은 거부
    const retry = await repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: TEAM_ID,
      answer: { type: 'golden_bell', choiceIndex: 1 },
      requestId: 'submit-1',
    });
    expect(retry.id).toBe(saved.id);
    await expect(
      repository.saveSubmission({
        eventId: DEFAULT_EVENT_ID,
        missionId: 'golden-bell',
        teamId: TEAM_ID,
        answer: { type: 'golden_bell', choiceIndex: 2 },
        requestId: 'submit-2',
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'not-allowed'));
  });

  it('순위 확정으로 뽑기권이 생기고, 한 장은 한 번만 쓸 수 있다', async () => {
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
    expect(outcome.ticketsByTeam[participants[0].team.id]).toBe(3);
    expect(outcome.ticketsByTeam[participants[1].team.id]).toBe(2);

    // 다시 확정해도 뽑기권이 늘지 않는다
    const again = await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-2',
      entries: [],
    });
    expect(again.alreadyFinalized).toBe(true);

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const tickets = await repository.listTeamTickets(DEFAULT_EVENT_ID, TEAM_ID);
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((ticket) => ticket.cardType === null)).toBe(true);

    const cardType = await repository.claimTicket(DEFAULT_EVENT_ID, TEAM_ID, tickets[0].id);
    expect(cardType).toBeTruthy();
    await expect(
      repository.claimTicket(DEFAULT_EVENT_ID, TEAM_ID, tickets[0].id),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'already-claimed'));

    const summary = await repository.getTeamCardSummary(DEFAULT_EVENT_ID, TEAM_ID);
    expect(summary.team[cardType]).toBe(1);
  });

  it('보유량보다 많은 교환은 막고, 정상 교환은 학급 수량에 반영된다', async () => {
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
    await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      requestId: 'finalize-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });

    await signInAsStudent();
    await repository.joinTeam(DEFAULT_EVENT_ID, TEAM_ID);
    const tickets = await repository.listTeamTickets(DEFAULT_EVENT_ID, TEAM_ID);
    const cardType = await repository.claimTicket(DEFAULT_EVENT_ID, TEAM_ID, tickets[0].id);

    await signInAsTeacher();
    const rows = await repository.listClassCardRows(DEFAULT_EVENT_ID, 4);
    const from = rows.find((row) => row.classInfo.id === 'g4-c1');
    const to = rows.find((row) => row.classInfo.id === 'g4-c2');
    expect(from?.counts[cardType]).toBe(1);

    await expect(
      repository.createExchange({
        eventId: DEFAULT_EVENT_ID,
        requestId: 'exchange-over',
        fromClassId: 'g4-c1',
        toClassId: 'g4-c2',
        cardType,
        quantity: 5,
      }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'insufficient-cards'));

    await repository.createExchange({
      eventId: DEFAULT_EVENT_ID,
      requestId: 'exchange-ok',
      fromClassId: 'g4-c1',
      toClassId: 'g4-c2',
      cardType,
      quantity: 1,
    });
    // 같은 요청 ID로 다시 보내도 기록은 하나만 남는다.
    await repository.createExchange({
      eventId: DEFAULT_EVENT_ID,
      requestId: 'exchange-ok',
      fromClassId: 'g4-c1',
      toClassId: 'g4-c2',
      cardType,
      quantity: 1,
    });

    const after = await repository.listClassCardRows(DEFAULT_EVENT_ID, 4);
    expect(after.find((row) => row.classInfo.id === 'g4-c1')?.counts[cardType]).toBe(0);
    expect(after.find((row) => row.classInfo.id === 'g4-c2')?.counts[cardType]).toBe(
      (to?.counts[cardType] ?? 0) + 1,
    );
    expect(await repository.listExchanges(DEFAULT_EVENT_ID, 4)).toHaveLength(1);
  });
});
