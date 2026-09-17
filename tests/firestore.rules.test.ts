import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Bytes, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-songjeong';
const EVENT = 'events/e1';

let testEnv: RulesTestEnvironment;

/** 익명 로그인 학생(팀 t1에 잠금)과 교사, 미등록 사용자 */
const studentDb = () => testEnv.authenticatedContext('student-a').firestore();
const otherStudentDb = () => testEnv.authenticatedContext('student-b').firestore();
const teacherDb = () => testEnv.authenticatedContext('teacher-1').firestore();
const strangerDb = () => testEnv.authenticatedContext('nobody').firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'teachers/teacher-1'), {
      displayName: '개발용 교사',
      email: 'teacher@example.com',
      role: 'admin',
      active: true,
    });
    await setDoc(doc(db, 'teachers/teacher-off'), {
      displayName: '비활성 교사',
      email: 'off@example.com',
      role: 'teacher',
      active: false,
    });
    await setDoc(doc(db, EVENT), {
      title: '2026 송정 AI 페스티벌',
      status: 'active',
      activeGrade: 4,
      activeRound: 1,
    });
    await setDoc(doc(db, `${EVENT}/missions/golden-bell`), { no: 1, type: 'golden_bell' });
    await setDoc(doc(db, `${EVENT}/missions/drawing`), { no: 3, type: 'drawing' });
    for (const teamId of ['t1', 't2']) {
      await setDoc(doc(db, `${EVENT}/teams/${teamId}`), {
        classId: 'g4-c1',
        grade: 4,
        classNo: 1,
        teamNo: teamId === 't1' ? 1 : 2,
      });
    }
    await setDoc(doc(db, `${EVENT}/sessions/student-a`), { uid: 'student-a', teamId: 't1' });
    const award = {
      resultId: 'golden-bell__g4__r1__t1',
      grade: 4,
      classId: 'g4-c1',
      teamId: 't1',
      missionId: 'golden-bell',
      roundNo: 1,
      rank: 1,
      selectionMode: 'choose_three',
      offeredTypes: ['thinking', 'observation', 'command'],
      selectedType: null,
      status: 'pending',
      createdAt: 1,
      claimedAt: null,
    };
    await setDoc(doc(db, `${EVENT}/cardAwards/award-pending`), award);
    await setDoc(doc(db, `${EVENT}/cardAwards/award-claimed`), {
      ...award,
      rank: 4,
      selectionMode: 'automatic',
      offeredTypes: ['observation'],
      selectedType: 'observation',
      status: 'claimed',
      claimedAt: new Date(),
    });
    await setDoc(doc(db, `${EVENT}/cardAwards/award-other`), { ...award, teamId: 't2' });
  });
});

async function seedSubmission(id: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `${EVENT}/submissions/${id}`), data);
  });
}

async function setEvent(data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), EVENT), data, { merge: true });
  });
}

function submission(teamId: string, extra: Record<string, unknown> = {}) {
  return {
    teamId,
    classId: 'g4-c1',
    missionId: 'golden-bell',
    grade: 4,
    roundNo: 1,
    status: 'submitted',
    answer: { type: 'golden_bell', selections: { q1: 1 } },
    score: null,
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

describe('제출물', () => {
  it('학생은 자기 팀 제출을 만들 수 있다', async () => {
    const db = studentDb();
    await assertSucceeds(setDoc(doc(db, `${EVENT}/submissions/golden-bell__t1`), submission('t1')));
  });

  it('학생은 다른 팀 제출을 만들 수 없다', async () => {
    const db = studentDb();
    await assertFails(setDoc(doc(db, `${EVENT}/submissions/golden-bell__t2`), submission('t2')));
  });

  it('팀에 잠기지 않은 기기는 제출할 수 없다', async () => {
    const db = otherStudentDb();
    await assertFails(setDoc(doc(db, `${EVENT}/submissions/golden-bell__t1`), submission('t1')));
  });

  it('학생은 점수를 넣을 수 없다', async () => {
    const db = studentDb();
    await assertFails(
      setDoc(doc(db, `${EVENT}/submissions/golden-bell__t1`), submission('t1', { score: 100 })),
    );
  });

  it('학생은 verified 상태로 바꿀 수 없다', async () => {
    const db = studentDb();
    await assertFails(
      setDoc(
        doc(db, `${EVENT}/submissions/golden-bell__t1`),
        submission('t1', { status: 'verified' }),
      ),
    );
  });

  it('순위가 확정된 뒤에는 학생이 제출할 수 없다', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `${EVENT}/results/golden-bell__g4__r1__t1`), {
        missionId: 'golden-bell',
        grade: 4,
        roundNo: 1,
        teamId: 't1',
        score: 100,
        rank: 1,
      });
    });
    const db = studentDb();
    await assertFails(setDoc(doc(db, `${EVENT}/submissions/golden-bell__t1`), submission('t1')));
  });

  it('지금 라운드가 아닌 미션은 제출할 수 없다', async () => {
    const db = studentDb();
    // t1(1팀)의 그리기 미션은 3라운드인데 지금은 1라운드
    await assertFails(
      setDoc(
        doc(db, `${EVENT}/submissions/drawing__t1`),
        submission('t1', { missionId: 'drawing', roundNo: 3 }),
      ),
    );
    // 라운드 번호를 지금 라운드로 속여도 팀·미션으로 다시 계산해 막는다.
    await assertFails(
      setDoc(
        doc(db, `${EVENT}/submissions/drawing__t1`),
        submission('t1', { missionId: 'drawing', roundNo: 1 }),
      ),
    );
  });

  it('라운드가 멈췄거나 끝나면 제출할 수 없다', async () => {
    await setEvent({ status: 'paused' });
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/submissions/golden-bell__t1`), submission('t1')),
    );
    await setEvent({ status: 'ready' });
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/submissions/golden-bell__t1`), submission('t1')),
    );
  });

  it('문서 ID와 팀·미션이 다르면 제출할 수 없다', async () => {
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/submissions/golden-bell__t2`), submission('t1')),
    );
  });

  it('제출한 뒤에는 학생이 덮어쓸 수 없다', async () => {
    await seedSubmission('golden-bell__t1', { ...submission('t1'), submittedAt: 1, updatedAt: 1 });
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/submissions/golden-bell__t1`), submission('t1')),
    );
  });

  it('교사가 재제출을 허용하면 라운드가 끝나도 다시 낼 수 있다', async () => {
    await seedSubmission('golden-bell__t1', {
      ...submission('t1'),
      status: 'draft',
      reopened: true,
      submittedAt: 1,
      updatedAt: 1,
    });
    await setEvent({ status: 'ready' });
    await assertSucceeds(
      setDoc(
        doc(studentDb(), `${EVENT}/submissions/golden-bell__t1`),
        submission('t1', { reopened: false }),
      ),
    );
  });

  it('교사는 제출을 되돌릴 수 있다', async () => {
    await seedSubmission('golden-bell__t1', { ...submission('t1'), submittedAt: 1, updatedAt: 1 });
    await assertSucceeds(
      updateDoc(doc(teacherDb(), `${EVENT}/submissions/golden-bell__t1`), {
        status: 'draft',
        reopened: true,
        score: null,
      }),
    );
  });
});

describe('순위와 카드', () => {
  it('학생은 순위를 쓸 수 없고 교사는 쓸 수 있다', async () => {
    const result = {
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      teamId: 't1',
      score: 100,
      rank: 1,
    };
    await assertFails(setDoc(doc(studentDb(), `${EVENT}/results/golden-bell__g4__r1__t1`), result));
    await assertSucceeds(
      setDoc(doc(teacherDb(), `${EVENT}/results/golden-bell__g4__r1__t1`), result),
    );
  });

  it('등록되지 않았거나 비활성 상태인 계정은 교사 권한이 없다', async () => {
    const result = {
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 1,
      teamId: 't1',
      score: 100,
      rank: 1,
    };
    await assertFails(
      setDoc(doc(strangerDb(), `${EVENT}/results/golden-bell__g4__r1__t1`), result),
    );
    const inactive = testEnv.authenticatedContext('teacher-off').firestore();
    await assertFails(setDoc(doc(inactive, `${EVENT}/results/golden-bell__g4__r1__t1`), result));
  });

  const claim = (selectedType: string, extra: Record<string, unknown> = {}) => ({
    status: 'claimed',
    selectedType,
    claimedAt: serverTimestamp(),
    claimRequestId: 'req-1',
    ...extra,
  });

  it('학생은 자기 팀 보상에서 제시된 후보 하나를 골라 받을 수 있다', async () => {
    await assertSucceeds(
      updateDoc(doc(studentDb(), `${EVENT}/cardAwards/award-pending`), claim('observation')),
    );
  });

  it('학생은 후보에 없는 카드 종류를 고를 수 없다', async () => {
    await assertFails(
      updateDoc(doc(studentDb(), `${EVENT}/cardAwards/award-pending`), claim('verification')),
    );
  });

  it('학생은 후보나 순위를 바꿀 수 없다', async () => {
    await assertFails(
      updateDoc(
        doc(studentDb(), `${EVENT}/cardAwards/award-pending`),
        claim('verification', { offeredTypes: ['verification'] }),
      ),
    );
    await assertFails(
      updateDoc(
        doc(studentDb(), `${EVENT}/cardAwards/award-pending`),
        claim('thinking', { rank: 2 }),
      ),
    );
  });

  it('이미 받은 보상은 다시 받을 수 없다', async () => {
    await assertFails(
      updateDoc(doc(studentDb(), `${EVENT}/cardAwards/award-claimed`), claim('observation')),
    );
  });

  it('다른 팀의 보상은 받을 수 없다', async () => {
    await assertFails(
      updateDoc(doc(studentDb(), `${EVENT}/cardAwards/award-other`), claim('thinking')),
    );
    await assertFails(
      updateDoc(doc(otherStudentDb(), `${EVENT}/cardAwards/award-pending`), claim('thinking')),
    );
  });

  it('카드 보상은 교사만 만들 수 있다', async () => {
    const award = {
      resultId: 'golden-bell__g4__r1__t2',
      grade: 4,
      classId: 'g4-c1',
      teamId: 't2',
      missionId: 'golden-bell',
      roundNo: 1,
      rank: 3,
      selectionMode: 'automatic',
      offeredTypes: ['thinking'],
      selectedType: 'thinking',
      status: 'claimed',
      createdAt: 1,
      claimedAt: 1,
    };
    await assertFails(setDoc(doc(studentDb(), `${EVENT}/cardAwards/new1`), award));
    await assertSucceeds(setDoc(doc(teacherDb(), `${EVENT}/cardAwards/new2`), award));
  });
});

describe('그림 제출', () => {
  function drawing(byteSize: number) {
    return {
      teamId: 't1',
      missionId: 'drawing',
      promptId: 'draw-sample-1',
      mimeType: 'image/webp',
      byteSize,
      width: 960,
      height: 540,
      imageBytes: Bytes.fromUint8Array(new Uint8Array(byteSize)),
      submittedAt: serverTimestamp(),
    };
  }

  it('300KB 이하 그림은 저장할 수 있다', async () => {
    await assertSucceeds(
      setDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t1`), drawing(300 * 1024)),
    );
  });

  it('350KB를 넘는 그림은 저장할 수 없다', async () => {
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t1`), drawing(360 * 1024)),
    );
  });

  it('WebP를 못 만드는 기기의 PNG 그림도 저장할 수 있다', async () => {
    await assertSucceeds(
      setDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t1`), {
        ...drawing(1024),
        mimeType: 'image/png',
      }),
    );
  });

  it('그림 제출을 마친 뒤에는 그림 파일을 바꿀 수 없다', async () => {
    await seedSubmission('drawing__t1', {
      ...submission('t1', { missionId: 'drawing', roundNo: 3 }),
      submittedAt: 1,
      updatedAt: 1,
    });
    await assertFails(setDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t1`), drawing(1024)));
  });

  it('학생은 그림 파일을 읽을 수 없고 교사는 읽을 수 있다', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `${EVENT}/drawingSubmissions/t1`), drawing(1024));
    });
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t1`)));
    await assertSucceeds(getDoc(doc(teacherDb(), `${EVENT}/drawingSubmissions/t1`)));
  });

  it('다른 팀 그림은 저장할 수 없다', async () => {
    await assertFails(
      setDoc(doc(studentDb(), `${EVENT}/drawingSubmissions/t2`), {
        ...drawing(1024),
        teamId: 't2',
      }),
    );
  });
});
