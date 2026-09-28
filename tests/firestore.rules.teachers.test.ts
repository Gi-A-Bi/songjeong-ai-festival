import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-songjeong';
const INVITED = 'invited@example.com';
const LEGACY = 'legacy@example.com';

let testEnv: RulesTestEnvironment;

/** Google 로그인으로 확인된 이메일을 가진 사용자 */
const googleDb = (uid: string, email: string) =>
  testEnv
    .authenticatedContext(uid, {
      email,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: {} },
    })
    .firestore();

const adminDb = () => googleDb('admin-1', 'admin@example.com');
const boothDb = () => googleDb('booth-1', 'booth@example.com');
const invitedDb = () => googleDb('invited-1', INVITED);
const strangerDb = () => googleDb('stranger-1', 'stranger@example.com');
/** 익명 로그인한 학생. 이메일이 없다. */
const studentDb = () => testEnv.authenticatedContext('student-a').firestore();

const invite = (email: string, overrides: Record<string, unknown> = {}) => ({
  email,
  displayName: '',
  role: 'teacher',
  active: true,
  createdBy: 'admin-1',
  createdAt: serverTimestamp(),
  ...overrides,
});

const claim = (email: string, overrides: Record<string, unknown> = {}) => ({
  email,
  displayName: '초대받은 선생님',
  role: 'teacher',
  active: true,
  createdAt: serverTimestamp(),
  ...overrides,
});

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
    await setDoc(doc(db, 'teachers/admin-1'), {
      displayName: '총괄 선생님',
      email: 'admin@example.com',
      role: 'admin',
      active: true,
    });
    await setDoc(doc(db, 'teachers/booth-1'), {
      displayName: '선생님',
      email: 'booth@example.com',
      role: 'teacher',
      active: true,
    });
    await setDoc(doc(db, `teacherInvites/${INVITED}`), {
      email: INVITED,
      displayName: '',
      role: 'teacher',
      active: true,
      createdBy: 'admin-1',
    });
    // 역할을 나누던 때에 담당과 함께 등록한 초대장
    await setDoc(doc(db, `teacherInvites/${LEGACY}`), {
      email: LEGACY,
      displayName: '',
      role: 'homeroom_teacher',
      missionId: null,
      classId: 'g4-c2',
      active: true,
      createdBy: 'admin-1',
    });
  });
});

describe('이메일로 교사 등록(teacherInvites)', () => {
  it('총괄 운영자는 이메일을 등록하고, 목록을 보고, 취소할 수 있다', async () => {
    const db = adminDb();
    await assertSucceeds(
      setDoc(doc(db, 'teacherInvites/new@example.com'), invite('new@example.com')),
    );
    await assertSucceeds(
      setDoc(
        doc(db, 'teacherInvites/head@example.com'),
        invite('head@example.com', { role: 'admin' }),
      ),
    );
    await assertSucceeds(getDocs(collection(db, 'teacherInvites')));
    await assertSucceeds(deleteDoc(doc(db, 'teacherInvites/new@example.com')));
  });

  it('총괄 운영자가 아니면 등록하거나 목록을 볼 수 없다', async () => {
    for (const db of [boothDb(), strangerDb(), studentDb()]) {
      await assertFails(
        setDoc(doc(db, 'teacherInvites/new@example.com'), invite('new@example.com')),
      );
      await assertFails(getDocs(collection(db, 'teacherInvites')));
      await assertFails(deleteDoc(doc(db, `teacherInvites/${INVITED}`)));
    }
  });

  it('자기 이메일을 총괄로 등록해 권한을 얻을 수 없다', async () => {
    await assertFails(
      setDoc(
        doc(strangerDb(), 'teacherInvites/stranger@example.com'),
        invite('stranger@example.com', { role: 'admin' }),
      ),
    );
  });

  it('문서 ID와 다른 이메일, 대문자 이메일, 없는 역할, 모르는 항목은 받지 않는다', async () => {
    const db = adminDb();
    await assertFails(setDoc(doc(db, 'teacherInvites/a@example.com'), invite('b@example.com')));
    await assertFails(
      setDoc(doc(db, 'teacherInvites/Upper@example.com'), invite('Upper@example.com')),
    );
    await assertFails(
      setDoc(doc(db, 'teacherInvites/a@example.com'), invite('a@example.com', { role: 'owner' })),
    );
    await assertFails(
      setDoc(doc(db, 'teacherInvites/a@example.com'), invite('a@example.com', { extra: true })),
    );
    // 부스·담임 역할은 없앴다. 새로 등록할 때는 교사와 총괄만 받고 담당은 적지 않는다.
    await assertFails(
      setDoc(
        doc(db, 'teacherInvites/a@example.com'),
        invite('a@example.com', { role: 'station_teacher' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, 'teacherInvites/a@example.com'),
        invite('a@example.com', { missionId: 'drawing' }),
      ),
    );
  });

  it('초대받은 본인은 자기 초대장만 읽는다', async () => {
    await assertSucceeds(getDoc(doc(invitedDb(), `teacherInvites/${INVITED}`)));
    await assertFails(getDoc(doc(strangerDb(), `teacherInvites/${INVITED}`)));
    await assertFails(getDoc(doc(studentDb(), `teacherInvites/${INVITED}`)));
    // 등록되지 않은 자기 이메일을 확인하는 것은 막지 않는다(없는 문서가 돌아온다).
    await assertSucceeds(getDoc(doc(strangerDb(), 'teacherInvites/stranger@example.com')));
  });

  it('이메일이 확인되지 않았거나 Google 로그인이 아니면 초대장을 읽을 수 없다', async () => {
    const unverified = testEnv
      .authenticatedContext('invited-1', {
        email: INVITED,
        email_verified: false,
        firebase: { sign_in_provider: 'google.com', identities: {} },
      })
      .firestore();
    const password = testEnv
      .authenticatedContext('invited-1', {
        email: INVITED,
        email_verified: true,
        firebase: { sign_in_provider: 'password', identities: {} },
      })
      .firestore();
    await assertFails(getDoc(doc(unverified, `teacherInvites/${INVITED}`)));
    await assertFails(getDoc(doc(password, `teacherInvites/${INVITED}`)));
    await assertFails(setDoc(doc(unverified, 'teachers/invited-1'), claim(INVITED)));
    await assertFails(setDoc(doc(password, 'teachers/invited-1'), claim(INVITED)));
  });
});

describe('초대받은 계정의 첫 로그인(teachers)', () => {
  it('초대장과 같은 역할로 자기 교사 문서를 만들 수 있다', async () => {
    await assertSucceeds(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
    // 교사가 된 뒤에는 담당 미션 설정을 바꿀 수 있다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'events/e1/missions/drawing'), { no: 3 });
    });
    await assertSucceeds(
      updateDoc(doc(invitedDb(), 'events/e1/missions/drawing'), { room: '미술실' }),
    );
  });

  it('토큰의 이메일이 대문자여도 소문자 초대장으로 등록된다', async () => {
    const upper = googleDb('invited-1', 'Invited@Example.com');
    await assertSucceeds(setDoc(doc(upper, 'teachers/invited-1'), claim(INVITED)));
  });

  it('초대장보다 높은 역할로는 만들 수 없다', async () => {
    const db = invitedDb();
    await assertFails(setDoc(doc(db, 'teachers/invited-1'), claim(INVITED, { role: 'admin' })));
    await assertFails(setDoc(doc(db, 'teachers/invited-1'), claim(INVITED, { active: false })));
    await assertFails(setDoc(doc(db, 'teachers/invited-1'), claim(INVITED, { extra: 1 })));
    await assertFails(
      setDoc(doc(db, 'teachers/invited-1'), claim(INVITED, { email: 'other@example.com' })),
    );
  });

  it('예전 역할로 등록된 초대장도 그 역할값 그대로 받아 교사가 된다', async () => {
    const legacy = googleDb('legacy-1', LEGACY);
    // 역할을 총괄로 올려 받을 수는 없다.
    await assertFails(setDoc(doc(legacy, 'teachers/legacy-1'), claim(LEGACY, { role: 'admin' })));
    await assertSucceeds(
      setDoc(doc(legacy, 'teachers/legacy-1'), claim(LEGACY, { role: 'homeroom_teacher' })),
    );
    // 담당을 나누지 않으므로 교사로서 어느 부스든 운영할 수 있다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'events/e1/missions/drawing'), { no: 3 });
    });
    await assertSucceeds(updateDoc(doc(legacy, 'events/e1/missions/drawing'), { room: '미술실' }));
  });

  it('초대받지 않은 계정과 학생은 교사 문서를 만들 수 없다', async () => {
    await assertFails(
      setDoc(doc(strangerDb(), 'teachers/stranger-1'), claim('stranger@example.com')),
    );
    await assertFails(setDoc(doc(studentDb(), 'teachers/student-a'), claim(INVITED)));
  });

  it('다른 사람의 교사 문서는 만들 수 없다', async () => {
    await assertFails(setDoc(doc(invitedDb(), 'teachers/someone-else'), claim(INVITED)));
  });

  it('취소된 초대장으로는 등록할 수 없다', async () => {
    await assertSucceeds(deleteDoc(doc(adminDb(), `teacherInvites/${INVITED}`)));
    await assertFails(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
  });

  it('등록된 뒤에는 자기 역할을 바꿀 수 없다', async () => {
    await assertSucceeds(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
    await assertFails(updateDoc(doc(invitedDb(), 'teachers/invited-1'), { role: 'admin' }));
    await assertFails(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
    await assertFails(updateDoc(doc(boothDb(), 'teachers/booth-1'), { role: 'admin' }));
  });
});

describe('교사 계정 관리(teachers)', () => {
  it('총괄 운영자는 교사 목록을 보고 다른 교사의 사용 여부를 바꿀 수 있다', async () => {
    const db = adminDb();
    await assertSucceeds(getDocs(collection(db, 'teachers')));
    await assertSucceeds(getDoc(doc(db, 'teachers/booth-1')));
    await assertSucceeds(
      updateDoc(doc(db, 'teachers/booth-1'), { active: false, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(doc(db, 'teachers/booth-1'), { active: true }));
  });

  it('사용 중지된 교사는 교사 권한이 없고, 초대장이 남아 있어도 다시 등록할 수 없다', async () => {
    await assertSucceeds(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
    await assertSucceeds(updateDoc(doc(adminDb(), 'teachers/invited-1'), { active: false }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'events/e1/missions/drawing'), { no: 3 });
    });
    await assertFails(
      updateDoc(doc(invitedDb(), 'events/e1/missions/drawing'), { room: '미술실' }),
    );
    await assertFails(setDoc(doc(invitedDb(), 'teachers/invited-1'), claim(INVITED)));
    await assertFails(updateDoc(doc(invitedDb(), 'teachers/invited-1'), { active: true }));
  });

  it('총괄 운영자도 역할은 바꿀 수 없고, 자기 계정은 잠글 수 없고, 문서를 지울 수 없다', async () => {
    const db = adminDb();
    await assertFails(updateDoc(doc(db, 'teachers/booth-1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'teachers/booth-1'), { active: 'no' }));
    await assertFails(updateDoc(doc(db, 'teachers/admin-1'), { active: false }));
    await assertFails(deleteDoc(doc(db, 'teachers/booth-1')));
  });

  it('총괄 운영자가 아니면 교사 목록을 보거나 사용 여부를 바꿀 수 없다', async () => {
    for (const db of [boothDb(), strangerDb(), studentDb()]) {
      await assertFails(getDocs(collection(db, 'teachers')));
      await assertFails(getDoc(doc(db, 'teachers/admin-1')));
      await assertFails(updateDoc(doc(db, 'teachers/booth-1'), { active: false }));
    }
    // 자기 문서는 볼 수 있다.
    await assertSucceeds(getDoc(doc(boothDb(), 'teachers/booth-1')));
  });
});
