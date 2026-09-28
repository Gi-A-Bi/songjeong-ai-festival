import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/*
 * v3 보안 규칙: 역할별 권한, 교실 QR 체크인, 부스 상태, 학급 전체 최종 미션.
 * 기준 상태: 4학년 진행 중. 과학실(ozobot) 부스가 2라운드를 열어 두었다.
 * t3(4학년 1반 3팀)은 2라운드에 4번 미션(ozobot)으로 간다.
 */
const PROJECT_ID = 'demo-songjeong';
const EVENT = 'events/e1';
const CLASS_ID = 'g4-c1';

let testEnv: RulesTestEnvironment;

const dbOf = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const studentDb = () => dbOf('student-a');
const otherStudentDb = () => dbOf('student-b');
const adminDb = () => dbOf('admin-1');
/** 교사(지금 역할). 모든 부스와 모든 학급을 맡을 수 있다. */
const homeroomDb = () => dbOf('teacher-1');
const ozobotTeacherDb = () => dbOf('teacher-2');
/** 예전에 담당과 함께 등록한 문서. 지금은 담당과 상관없이 교사로 본다. */
const drawingTeacherDb = () => dbOf('legacy-station-drawing');
const otherHomeroomDb = () => dbOf('legacy-homeroom-c2');
const inactiveTeacherDb = () => dbOf('teacher-off');

async function seed(write: (db: ReturnType<typeof dbOf>) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await write(context.firestore() as unknown as ReturnType<typeof dbOf>);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    const teacher = (role: string, extra: Record<string, unknown> = {}) => ({
      displayName: role,
      email: `${role}@example.com`,
      role,
      active: true,
      ...extra,
    });
    await setDoc(doc(db, 'teachers/admin-1'), teacher('admin'));
    await setDoc(doc(db, 'teachers/teacher-1'), teacher('teacher'));
    await setDoc(doc(db, 'teachers/teacher-2'), teacher('teacher'));
    await setDoc(
      doc(db, 'teachers/legacy-station-drawing'),
      teacher('station_teacher', { missionId: 'drawing' }),
    );
    await setDoc(
      doc(db, 'teachers/legacy-homeroom-c2'),
      teacher('homeroom_teacher', { classId: 'g4-c2' }),
    );
    await setDoc(doc(db, 'teachers/teacher-off'), { ...teacher('teacher'), active: false });

    await setDoc(doc(db, EVENT), {
      title: '2026 송정 AI 미션 챌린지',
      status: 'active',
      activeGrade: 4,
      gameDurationMs: 600_000,
    });
    await setDoc(doc(db, `${EVENT}/missionRoundStates/ozobot_g4_r2`), {
      grade: 4,
      missionId: 'ozobot',
      roundNo: 2,
      openedAt: Timestamp.fromMillis(Date.now() - 60_000),
      startedAt: null,
      durationMs: 600_000,
      resultFinalizedAt: null,
      completedAt: null,
      resultTeamIds: [],
    });
    const missions = ['golden-bell', 'error-hunt', 'drawing', 'ozobot', 'library-check'];
    for (const [index, id] of missions.entries()) {
      await setDoc(doc(db, `${EVENT}/missions/${id}`), { no: index + 1, type: id });
    }
    await setDoc(doc(db, `${EVENT}/classes/${CLASS_ID}`), { grade: 4, classNo: 1 });
    await setDoc(doc(db, `${EVENT}/classes/g4-c2`), { grade: 4, classNo: 2 });
    await setDoc(doc(db, `${EVENT}/teams/t3`), {
      classId: CLASS_ID,
      grade: 4,
      classNo: 1,
      teamNo: 3,
    });
    await setDoc(doc(db, `${EVENT}/teams/t4`), {
      classId: CLASS_ID,
      grade: 4,
      classNo: 1,
      teamNo: 4,
    });
    await setDoc(doc(db, `${EVENT}/sessions/student-a`), { uid: 'student-a', teamId: 't3' });
  });
});

// ---- 역할 ----

describe('역할별 권한', () => {
  const result = (missionId: string) => ({
    missionId,
    grade: 4,
    roundNo: 2,
    teamId: 't3',
    score: 100,
    rank: 1,
  });

  it('교사는 담당을 나누지 않고 어느 부스든 순위를 확정할 수 있다', async () => {
    await assertSucceeds(
      setDoc(doc(ozobotTeacherDb(), `${EVENT}/results/ozobot__g4__r2__t3`), result('ozobot')),
    );
    await assertSucceeds(
      setDoc(doc(ozobotTeacherDb(), `${EVENT}/results/drawing__g4__r2__t3`), result('drawing')),
    );
    await assertSucceeds(
      setDoc(doc(homeroomDb(), `${EVENT}/results/golden-bell__g4__r2__t3`), result('golden-bell')),
    );
  });

  it('예전에 부스·담임으로 등록한 계정도 교사로서 어느 부스든 운영할 수 있다', async () => {
    await assertSucceeds(
      setDoc(doc(drawingTeacherDb(), `${EVENT}/results/ozobot__g4__r2__t3`), result('ozobot')),
    );
    await assertSucceeds(
      setDoc(doc(otherHomeroomDb(), `${EVENT}/results/drawing__g4__r2__t3`), result('drawing')),
    );
  });

  it('사용 중지된 교사와 학생은 부스 결과를 쓸 수 없다', async () => {
    await assertFails(
      setDoc(doc(inactiveTeacherDb(), `${EVENT}/results/ozobot__g4__r2__t3`), result('ozobot')),
    );
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/results/ozobot__g4__r2__t3`), result('ozobot')),
    );
  });

  it('진행 학년, 게임 시간, 행사 구조는 총괄 운영자만 바꾼다', async () => {
    await assertFails(updateDoc(doc(ozobotTeacherDb(), EVENT), { activeGrade: 5 }));
    await assertFails(updateDoc(doc(homeroomDb(), EVENT), { gameDurationMs: 300_000 }));
    await assertFails(updateDoc(doc(studentDb(), EVENT), { gameDurationMs: 3_600_000 }));
    await assertSucceeds(updateDoc(doc(adminDb(), EVENT), { activeGrade: 5 }));
    await assertSucceeds(updateDoc(doc(adminDb(), EVENT), { gameDurationMs: 480_000 }));
  });

  it('예전 구조의 전체 라운드 문서는 더 쓰지 않는다', async () => {
    await assertFails(
      setDoc(doc(adminDb(), `${EVENT}/rounds/g4-r3`), { grade: 4, roundNo: 3, status: 'active' }),
    );
  });

  it('미션 설정은 교사가 고치고 학생은 고칠 수 없다', async () => {
    await assertSucceeds(
      updateDoc(doc(ozobotTeacherDb(), `${EVENT}/missions/ozobot`), { config: { type: 'ozobot' } }),
    );
    await assertSucceeds(
      updateDoc(doc(drawingTeacherDb(), `${EVENT}/missions/ozobot`), {
        config: { type: 'ozobot' },
      }),
    );
    await assertFails(
      updateDoc(doc(studentDb(), `${EVENT}/missions/ozobot`), { config: { type: 'ozobot' } }),
    );
    await assertFails(
      updateDoc(doc(inactiveTeacherDb(), `${EVENT}/missions/ozobot`), {
        config: { type: 'ozobot' },
      }),
    );
  });

  it('기기 시계 맞춤 문서는 자기 것에 서버 시각만 적을 수 있다', async () => {
    await assertSucceeds(
      setDoc(doc(studentDb(), `${EVENT}/clockSync/student-a`), { at: serverTimestamp() }),
    );
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/clockSync/student-a`), { at: Timestamp.fromMillis(1) }),
    );
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/clockSync/student-b`), { at: serverTimestamp() }),
    );
  });
});

describe('기기 잠금(세션)', () => {
  it('학생은 자기 세션을 지우거나 다른 팀으로 바꿀 수 없다', async () => {
    await assertFails(deleteDoc(doc(studentDb(), `${EVENT}/sessions/student-a`)));
    await assertFails(updateDoc(doc(studentDb(), `${EVENT}/sessions/student-a`), { teamId: 't4' }));
  });

  it('교사는 역할과 상관없이 기기 목록을 보고 잠금을 풀 수 있다', async () => {
    await assertSucceeds(getDoc(doc(homeroomDb(), `${EVENT}/sessions/student-a`)));
    await assertSucceeds(deleteDoc(doc(ozobotTeacherDb(), `${EVENT}/sessions/student-a`)));
    // 잠금이 풀린 기기는 새 팀으로 다시 입장할 수 있다.
    await assertSucceeds(
      setDoc(doc(studentDb(), `${EVENT}/sessions/student-a`), { uid: 'student-a', teamId: 't4' }),
    );
  });

  it('다른 학생의 세션은 읽거나 지울 수 없다', async () => {
    await assertFails(getDoc(doc(otherStudentDb(), `${EVENT}/sessions/student-a`)));
    await assertFails(deleteDoc(doc(otherStudentDb(), `${EVENT}/sessions/student-a`)));
  });
});

// ---- 교실 QR 체크인 ----

function arrival(extra: Record<string, unknown> = {}) {
  return {
    grade: 4,
    classId: CLASS_ID,
    teamId: 't3',
    teamNo: 3,
    roundNo: 2,
    expectedMissionId: 'ozobot',
    actualMissionId: 'ozobot',
    wrongStationId: null,
    manualReview: false,
    checkedInAt: serverTimestamp(),
    checkedInBy: 'team',
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

const wrongScan = (extra: Record<string, unknown> = {}) =>
  arrival({
    actualMissionId: 'golden-bell',
    wrongStationId: 'golden-bell',
    checkedInAt: null,
    checkedInBy: null,
    ...extra,
  });

describe('교실 QR 체크인', () => {
  const stateRef = (db: ReturnType<typeof dbOf>, id = `${CLASS_ID}_3_2`) =>
    doc(db, `${EVENT}/teamMissionStates/${id}`);

  it('학생은 자기 팀의 이번 라운드 교실에 입장을 기록할 수 있다', async () => {
    await assertSucceeds(setDoc(stateRef(studentDb()), arrival()));
  });

  it('입장 시각은 서버 시각이어야 한다', async () => {
    await assertFails(
      setDoc(stateRef(studentDb()), arrival({ checkedInAt: Timestamp.fromMillis(1000) })),
    );
  });

  it('다른 팀이나 팀에 입장하지 않은 기기는 체크인할 수 없다', async () => {
    await assertFails(
      setDoc(stateRef(studentDb(), `${CLASS_ID}_4_2`), arrival({ teamId: 't4', teamNo: 4 })),
    );
    await assertFails(setDoc(stateRef(otherStudentDb()), arrival()));
  });

  it('가야 할 교실을 속이거나 문서 ID가 다르면 막는다', async () => {
    await assertFails(
      setDoc(
        stateRef(studentDb()),
        arrival({ expectedMissionId: 'golden-bell', actualMissionId: 'golden-bell' }),
      ),
    );
    await assertFails(setDoc(stateRef(studentDb(), `${CLASS_ID}_3_5`), arrival()));
  });

  it('선생님이 라운드를 연 부스에만 입장할 수 있다', async () => {
    // 3라운드(도서관)는 아직 열리지 않았다.
    const next = arrival({
      roundNo: 3,
      expectedMissionId: 'library-check',
      actualMissionId: 'library-check',
    });
    await assertFails(setDoc(stateRef(studentDb(), `${CLASS_ID}_3_3`), next));
    await seed((db) =>
      setDoc(doc(db, `${EVENT}/missionRoundStates/library-check_g4_r3`), {
        grade: 4,
        missionId: 'library-check',
        roundNo: 3,
        openedAt: Timestamp.now(),
        startedAt: null,
        completedAt: null,
      }),
    );
    await assertSucceeds(setDoc(stateRef(studentDb(), `${CLASS_ID}_3_3`), next));
  });

  it('게임 중에도 입장할 수 있고, 라운드를 종료한 부스에는 입장할 수 없다', async () => {
    const boothRef = (db: ReturnType<typeof dbOf>) =>
      doc(db, `${EVENT}/missionRoundStates/ozobot_g4_r2`);
    await seed((db) => updateDoc(boothRef(db), { startedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(stateRef(studentDb()), arrival()));

    await seed((db) => deleteDoc(stateRef(db)));
    await seed((db) => updateDoc(boothRef(db), { completedAt: Timestamp.now() }));
    await assertFails(setDoc(stateRef(studentDb()), arrival()));
  });

  it('예전 부스 문서는 게임을 시작했으면 연 것으로 본다', async () => {
    await seed((db) =>
      setDoc(doc(db, `${EVENT}/missionRoundStates/ozobot_g4_r2`), {
        grade: 4,
        missionId: 'ozobot',
        roundNo: 2,
        status: 'active',
        startedAt: Timestamp.now(),
        completedAt: null,
      }),
    );
    await assertSucceeds(setDoc(stateRef(studentDb()), arrival()));
  });

  it('다른 학년이 진행 중이면 입장할 수 없다', async () => {
    await seed((db) => updateDoc(doc(db, EVENT), { activeGrade: 5 }));
    await assertFails(setDoc(stateRef(studentDb()), arrival()));
  });

  it('가야 할 부스가 아직 열리지 않았어도 다른 교실 QR을 찍은 기록은 남긴다', async () => {
    await seed((db) => deleteDoc(doc(db, `${EVENT}/missionRoundStates/ozobot_g4_r2`)));
    await assertSucceeds(setDoc(stateRef(studentDb()), wrongScan()));
    // 열리지 않은 부스에는 입장할 수 없다.
    await assertFails(setDoc(stateRef(studentDb()), arrival()));
  });

  it('다른 교실 QR은 입장으로 치지 않고 잘못 찍은 교실만 남긴다', async () => {
    await assertSucceeds(setDoc(stateRef(studentDb()), wrongScan()));
    // 그 뒤 올바른 교실에 입장할 수 있다.
    await assertSucceeds(setDoc(stateRef(studentDb()), arrival()));
    // 잘못 찍은 기록에 입장 시각을 넣을 수는 없다.
    await assertFails(
      setDoc(
        stateRef(studentDb(), `${CLASS_ID}_3_2`),
        wrongScan({ checkedInAt: serverTimestamp(), checkedInBy: 'team' }),
      ),
    );
  });

  it('이미 입장한 기록은 학생이 다시 쓸 수 없다', async () => {
    await assertSucceeds(setDoc(stateRef(studentDb()), arrival()));
    await assertFails(setDoc(stateRef(studentDb()), arrival()));
    await assertFails(setDoc(stateRef(studentDb()), wrongScan()));
    await assertFails(deleteDoc(stateRef(studentDb())));
  });

  it('학생은 직접 확인 표시를 넣을 수 없다', async () => {
    await assertFails(setDoc(stateRef(studentDb()), arrival({ manualReview: true })));
  });

  it('교사는 어느 교실에서든 팀을 직접 입장 처리할 수 있다', async () => {
    await assertSucceeds(setDoc(stateRef(ozobotTeacherDb()), arrival({ checkedInBy: 'teacher' })));
    await assertFails(setDoc(stateRef(inactiveTeacherDb()), arrival({ checkedInBy: 'teacher' })));
  });
});

describe('부스 라운드', () => {
  const booth = (missionId: string) => ({
    grade: 4,
    missionId,
    roundNo: 2,
    openedAt: serverTimestamp(),
    startedAt: serverTimestamp(),
    durationMs: 600_000,
    completedAt: null,
    resultFinalizedAt: null,
    resultTeamIds: [],
    updatedBy: 'x',
    updatedAt: serverTimestamp(),
  });

  it('교사는 라운드를 열고, 게임을 시작하고, 종료할 수 있다', async () => {
    const ref = doc(homeroomDb(), `${EVENT}/missionRoundStates/drawing_g4_r2`);
    const base = { grade: 4, missionId: 'drawing', roundNo: 2, updatedBy: 'teacher-1' };
    const merge = { merge: true };
    await assertSucceeds(
      setDoc(ref, { ...base, openedAt: serverTimestamp(), startedAt: null }, merge),
    );
    await assertSucceeds(
      setDoc(ref, { ...base, startedAt: serverTimestamp(), durationMs: 600_000 }, merge),
    );
    await assertSucceeds(setDoc(ref, { ...base, resultFinalizedAt: serverTimestamp() }, merge));
    await assertSucceeds(setDoc(ref, { ...base, completedAt: serverTimestamp() }, merge));
    // 학생과 사용 중지된 교사는 부스 라운드를 바꿀 수 없다.
    await assertFails(
      setDoc(
        doc(studentDb(), `${EVENT}/missionRoundStates/drawing_g4_r2`),
        { ...base, completedAt: null },
        merge,
      ),
    );
    await assertFails(
      setDoc(
        doc(inactiveTeacherDb(), `${EVENT}/missionRoundStates/drawing_g4_r2`),
        { ...base, completedAt: null },
        merge,
      ),
    );
  });

  it('교사는 어느 부스든 시작할 수 있고 학생은 쓸 수 없다', async () => {
    await assertSucceeds(
      setDoc(doc(ozobotTeacherDb(), `${EVENT}/missionRoundStates/ozobot_g4_r2`), booth('ozobot')),
    );
    await assertSucceeds(
      setDoc(
        doc(drawingTeacherDb(), `${EVENT}/missionRoundStates/golden-bell_g4_r2`),
        booth('golden-bell'),
      ),
    );
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/missionRoundStates/error-hunt_g4_r2`), booth('error-hunt')),
    );
    // 문서 ID와 다른 미션을 적을 수 없다.
    await assertFails(
      setDoc(
        doc(drawingTeacherDb(), `${EVENT}/missionRoundStates/library-check_g4_r2`),
        booth('drawing'),
      ),
    );
  });

  it('학생도 부스 상태를 읽을 수 있다(늦게 입장했을 때 진행 중으로 보이게)', async () => {
    await seed((db) =>
      setDoc(doc(db, `${EVENT}/missionRoundStates/ozobot_g4_r2`), booth('ozobot')),
    );
    await assertSucceeds(getDoc(doc(studentDb(), `${EVENT}/missionRoundStates/ozobot_g4_r2`)));
  });
});

// ---- 학급 전체 최종 미션 ----

function startState(extra: Record<string, unknown> = {}) {
  return {
    classId: CLASS_ID,
    grade: 4,
    status: 'active',
    currentQuestionIndex: 0,
    completedCardTypeCountSnapshot: 3,
    allFiveCardsCompletedSnapshot: false,
    hintTotal: 3,
    hintUsed: 0,
    startedAt: serverTimestamp(),
    submittedAt: null,
    durationMs: null,
    correctCount: null,
    finalRank: null,
    manualOverride: false,
    overrideReason: null,
    overrideBy: null,
    questionCount: 10,
    durationLimitSec: 720,
    startRequestId: 'start-1',
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

async function openSession() {
  await seed((db) =>
    setDoc(doc(db, `${EVENT}/finalSessions/4`), {
      grade: 4,
      status: 'open',
      questionCount: 10,
      durationLimitSec: 720,
    }),
  );
}

/** 이미 시작한 학급 상태를 넣는다. startedMsAgo로 제한 시간이 지난 상황을 만든다. */
async function seedActiveState(extra: Record<string, unknown> = {}, startedMsAgo = 60_000) {
  await seed((db) =>
    setDoc(
      doc(db, `${EVENT}/finalClassStates/${CLASS_ID}`),
      startState({
        startedAt: Timestamp.fromMillis(Date.now() - startedMsAgo),
        updatedAt: Timestamp.fromMillis(Date.now() - startedMsAgo),
        ...extra,
      }),
    ),
  );
}

describe('최종 미션 시작', () => {
  const stateRef = (db: ReturnType<typeof dbOf>, classId = CLASS_ID) =>
    doc(db, `${EVENT}/finalClassStates/${classId}`);

  it('총괄 운영자가 열기 전에는 교사가 시작할 수 없다', async () => {
    await assertFails(setDoc(stateRef(homeroomDb()), startState()));
    await seed((db) => setDoc(doc(db, `${EVENT}/finalSessions/4`), { grade: 4, status: 'locked' }));
    await assertFails(setDoc(stateRef(homeroomDb()), startState()));
  });

  it('열린 뒤에는 교사가 서버 시각으로 시작할 수 있고 학생은 시작할 수 없다', async () => {
    await openSession();
    await assertFails(setDoc(stateRef(studentDb()), startState()));
    await assertFails(setDoc(stateRef(inactiveTeacherDb()), startState()));
    await assertFails(
      setDoc(stateRef(homeroomDb()), startState({ startedAt: Timestamp.fromMillis(1) })),
    );
    await assertSucceeds(setDoc(stateRef(homeroomDb()), startState()));
  });

  it('예전에 다른 반 담임으로 등록한 계정도 교사로서 시작할 수 있다', async () => {
    await openSession();
    await assertSucceeds(setDoc(stateRef(otherHomeroomDb()), startState()));
  });

  it('시작할 때 점수·순위를 넣거나 힌트 수를 부풀릴 수 없다', async () => {
    await openSession();
    await assertFails(setDoc(stateRef(homeroomDb()), startState({ correctCount: 10 })));
    await assertFails(setDoc(stateRef(homeroomDb()), startState({ finalRank: 1 })));
    await assertFails(setDoc(stateRef(homeroomDb()), startState({ hintTotal: 5 })));
    await assertFails(
      setDoc(stateRef(homeroomDb()), startState({ allFiveCardsCompletedSnapshot: true })),
    );
    await assertFails(setDoc(stateRef(homeroomDb()), startState({ durationLimitSec: 3600 })));
  });

  it('세션을 열고 결과를 공개하는 것은 총괄 운영자만 한다', async () => {
    const session = { grade: 4, status: 'open', questionCount: 10, durationLimitSec: 720 };
    await assertFails(setDoc(doc(homeroomDb(), `${EVENT}/finalSessions/4`), session));
    await assertSucceeds(setDoc(doc(adminDb(), `${EVENT}/finalSessions/4`), session));
  });

  it('학생은 최종 미션 문서를 읽을 수 없다', async () => {
    await openSession();
    await assertFails(getDoc(doc(studentDb(), `${EVENT}/finalSessions/4`)));
    await assertFails(getDoc(doc(studentDb(), `${EVENT}/finalQuestionSets/4`)));
    await assertFails(getDoc(stateRef(studentDb())));
  });

  it('정답 문서는 총괄 운영자만 읽는다', async () => {
    await seed((db) =>
      setDoc(doc(db, `${EVENT}/finalAnswerKeys/4`), { grade: 4, answers: { q1: 'b' } }),
    );
    await assertFails(getDoc(doc(homeroomDb(), `${EVENT}/finalAnswerKeys/4`)));
    await assertFails(getDoc(doc(ozobotTeacherDb(), `${EVENT}/finalAnswerKeys/4`)));
    await assertSucceeds(getDoc(doc(adminDb(), `${EVENT}/finalAnswerKeys/4`)));
  });
});

describe('최종 미션 진행과 제출', () => {
  const stateRef = (db: ReturnType<typeof dbOf>) =>
    doc(db, `${EVENT}/finalClassStates/${CLASS_ID}`);
  const responsesRef = (db: ReturnType<typeof dbOf>) =>
    doc(db, `${EVENT}/finalResponses/${CLASS_ID}`);
  const answer = (choice: string, extra: Record<string, unknown> = {}) => ({
    questionId: 'q1',
    selectedChoiceId: choice,
    hintUsed: false,
    removedChoiceId: null,
    confirmedAt: null,
    ...extra,
  });

  beforeEach(openSession);

  it('문제 번호와 힌트 사용 수는 하나씩만 늘릴 수 있다', async () => {
    await seedActiveState();
    await assertSucceeds(
      updateDoc(stateRef(homeroomDb()), { currentQuestionIndex: 1, updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(stateRef(homeroomDb()), { currentQuestionIndex: 3, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(stateRef(homeroomDb()), { hintUsed: 1, updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(stateRef(homeroomDb()), { hintUsed: 3, updatedAt: serverTimestamp() }),
    );
  });

  it('보유한 힌트보다 많이 쓸 수 없다', async () => {
    await seedActiveState({ hintUsed: 3 });
    await assertFails(
      updateDoc(stateRef(homeroomDb()), { hintUsed: 4, updatedAt: serverTimestamp() }),
    );
  });

  it('교사는 점수·순위·스냅샷·시작 시각을 고칠 수 없다', async () => {
    await seedActiveState();
    await assertFails(updateDoc(stateRef(homeroomDb()), { correctCount: 10 }));
    await assertFails(updateDoc(stateRef(homeroomDb()), { finalRank: 1 }));
    await assertFails(updateDoc(stateRef(homeroomDb()), { hintTotal: 5 }));
    await assertFails(updateDoc(stateRef(homeroomDb()), { startedAt: serverTimestamp() }));
    await assertFails(deleteDoc(stateRef(homeroomDb())));
  });

  it('제출은 마지막 문제를 확정할 때만, 서버 시각으로 기록된다', async () => {
    await seedActiveState({ currentQuestionIndex: 5 });
    const submit = {
      status: 'submitted',
      currentQuestionIndex: 10,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertFails(updateDoc(stateRef(homeroomDb()), submit));

    await seedActiveState({ currentQuestionIndex: 9 });
    await assertFails(
      updateDoc(stateRef(homeroomDb()), { ...submit, submittedAt: Timestamp.fromMillis(1) }),
    );
    await assertSucceeds(updateDoc(stateRef(homeroomDb()), submit));
    // 제출한 뒤에는 더 바꿀 수 없다.
    await assertFails(
      updateDoc(stateRef(homeroomDb()), { hintUsed: 1, updatedAt: serverTimestamp() }),
    );
  });

  it('시간 마감은 제한 시간이 지난 뒤에만 기록할 수 있고, 그 뒤에는 제출할 수 없다', async () => {
    const timeout = {
      status: 'timeout',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await seedActiveState();
    await assertFails(updateDoc(stateRef(homeroomDb()), timeout));

    // 13분 전에 시작(제한 12분)
    await seedActiveState({ currentQuestionIndex: 9 }, 13 * 60_000);
    await assertFails(
      updateDoc(stateRef(homeroomDb()), {
        status: 'submitted',
        currentQuestionIndex: 10,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(updateDoc(stateRef(homeroomDb()), timeout));
  });

  it('응답은 지금 푸는 문제 번호만 바꿀 수 있다', async () => {
    await seedActiveState();
    await assertSucceeds(
      setDoc(responsesRef(homeroomDb()), {
        classId: CLASS_ID,
        grade: 4,
        answers: { '0': answer('a') },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(
        responsesRef(homeroomDb()),
        { answers: { '0': answer('b') }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(
        responsesRef(homeroomDb()),
        { answers: { '4': answer('b') }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it('확정하고 넘어간 문제의 답은 고칠 수 없다', async () => {
    await seedActiveState({ currentQuestionIndex: 1 });
    await seed((db) =>
      setDoc(doc(db, `${EVENT}/finalResponses/${CLASS_ID}`), {
        classId: CLASS_ID,
        grade: 4,
        answers: { '0': answer('a', { confirmedAt: Timestamp.fromMillis(1) }) },
      }),
    );
    await assertFails(
      setDoc(
        responsesRef(homeroomDb()),
        { answers: { '0': answer('b') }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(
        responsesRef(homeroomDb()),
        { answers: { '1': answer('c', { questionId: 'q2' }) }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it('답 확정은 응답과 학급 상태를 한 번에 바꾼다', async () => {
    await seedActiveState();
    const db = homeroomDb();
    const batch = writeBatch(db);
    batch.set(responsesRef(db), {
      classId: CLASS_ID,
      grade: 4,
      answers: { '0': answer('a', { confirmedAt: serverTimestamp() }) },
      updatedAt: serverTimestamp(),
    });
    batch.update(stateRef(db), { currentQuestionIndex: 1, updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('응답은 교사만 읽고 쓴다. 학생과 사용 중지된 교사는 할 수 없다', async () => {
    await seedActiveState();
    const data = {
      classId: CLASS_ID,
      grade: 4,
      answers: { '0': answer('a') },
      updatedAt: serverTimestamp(),
    };
    await assertFails(setDoc(responsesRef(studentDb()), data));
    await assertFails(setDoc(responsesRef(inactiveTeacherDb()), data));
    await assertFails(getDoc(responsesRef(studentDb())));
    await assertSucceeds(getDoc(responsesRef(homeroomDb())));
    await assertSucceeds(setDoc(responsesRef(ozobotTeacherDb()), data));
  });

  it('제한 시간이 끝난 뒤에는 답을 쓸 수 없다', async () => {
    await seedActiveState({}, 13 * 60_000 + 40_000);
    await assertFails(
      setDoc(responsesRef(homeroomDb()), {
        classId: CLASS_ID,
        grade: 4,
        answers: { '0': answer('a') },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('총괄 운영자는 결과를 보정하고 학급을 초기화할 수 있다', async () => {
    await seedActiveState({ status: 'submitted', currentQuestionIndex: 10 });
    await assertSucceeds(
      updateDoc(stateRef(adminDb()), {
        correctCount: 8,
        finalRank: 1,
        manualOverride: true,
        overrideReason: '채점 확인',
        overrideBy: 'admin-1',
      }),
    );
    await assertSucceeds(deleteDoc(stateRef(adminDb())));
  });
});
