import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import {
  getTeacherInviteError,
  normalizeEmail,
  TEACHER_NAME_MAX_LENGTH,
  toTeacherRole,
  type TeacherInviteDraft,
} from '../../domain/teacherInvites';
import type { TeacherAccount, TeacherInvite, TeacherProfile } from '../../domain/types';
import { RepositoryError } from '../errors';
import { toMillis } from './mappers';

const TEACHERS = 'teachers';
const INVITES = 'teacherInvites';

function mapAccount(uid: string, data: DocumentData): TeacherAccount {
  return {
    uid,
    displayName: String(data.displayName ?? '선생님'),
    email: String(data.email ?? ''),
    role: toTeacherRole(data.role),
    active: data.active === true,
  };
}

function mapInvite(id: string, data: DocumentData): TeacherInvite {
  return {
    email: id,
    displayName: String(data.displayName ?? ''),
    role: toTeacherRole(data.role),
    createdAt: toMillis(data.createdAt),
  };
}

export interface LoadedTeacher {
  /** 교사 문서가 있는지. 있는데 profile이 없으면 사용이 중지된 계정이다. */
  registered: boolean;
  profile: TeacherProfile | null;
}

export async function loadTeacher(db: Firestore, uid: string): Promise<LoadedTeacher> {
  const data = (await getDoc(doc(db, TEACHERS, uid))).data();
  if (!data) return { registered: false, profile: null };
  if (data.active !== true) return { registered: true, profile: null };
  const { displayName, role } = mapAccount(uid, data);
  return { registered: true, profile: { uid, displayName, role } };
}

/**
 * 이메일로 미리 등록된 계정이 처음 로그인했을 때 자기 교사 문서를 만든다.
 * 역할은 초대장의 값 그대로여야 보안 규칙을 통과한다. 등록되지 않았으면 false.
 */
export async function claimTeacherInvite(
  db: Firestore,
  user: Pick<User, 'uid' | 'email' | 'emailVerified' | 'displayName' | 'isAnonymous'>,
): Promise<boolean> {
  if (user.isAnonymous || !user.email || !user.emailVerified) return false;
  const email = normalizeEmail(user.email);
  try {
    const invite = (await getDoc(doc(db, INVITES, email))).data();
    if (!invite || invite.active !== true) return false;
    const name = String(invite.displayName ?? '').trim() || user.displayName?.trim() || '선생님';
    await setDoc(doc(db, TEACHERS, user.uid), {
      email,
      displayName: name.slice(0, TEACHER_NAME_MAX_LENGTH),
      // 예전 역할값으로 등록된 초대장도 그대로 옮긴다(읽을 때 교사로 본다).
      role: invite.role,
      active: true,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch {
    // 등록되지 않은 계정은 초대장을 읽거나 교사 문서를 만들 수 없다.
    return false;
  }
}

export async function listTeacherInvites(db: Firestore): Promise<TeacherInvite[]> {
  const snapshot = await getDocs(collection(db, INVITES));
  return snapshot.docs
    .map((item) => mapInvite(item.id, item.data()))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function saveTeacherInvites(
  db: Firestore,
  adminUid: string,
  draft: TeacherInviteDraft,
): Promise<void> {
  const error = getTeacherInviteError(draft);
  if (error) throw new RepositoryError('invalid-input', error);
  const batch = writeBatch(db);
  for (const email of draft.emails) {
    batch.set(doc(db, INVITES, email), {
      email,
      displayName: '',
      role: draft.role,
      active: true,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function deleteTeacherInvite(db: Firestore, email: string): Promise<void> {
  await deleteDoc(doc(db, INVITES, normalizeEmail(email)));
}

export async function listTeacherAccounts(db: Firestore): Promise<TeacherAccount[]> {
  const snapshot = await getDocs(collection(db, TEACHERS));
  return snapshot.docs
    .map((item) => mapAccount(item.id, item.data()))
    .sort((a, b) => a.email.localeCompare(b.email) || a.uid.localeCompare(b.uid));
}

export async function setTeacherActive(
  db: Firestore,
  uid: string,
  active: boolean,
): Promise<TeacherAccount> {
  const ref = doc(db, TEACHERS, uid);
  await updateDoc(ref, { active, updatedAt: serverTimestamp() });
  const data = (await getDoc(ref)).data();
  if (!data) throw new RepositoryError('not-found', '교사 계정을 찾을 수 없어요.');
  return mapAccount(uid, data);
}
