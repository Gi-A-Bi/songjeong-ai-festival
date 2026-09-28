import type { TeacherRole } from './types';

/** 한 번에 등록할 수 있는 이메일 수(Firestore 일괄 쓰기와 화면 확인을 생각한 값) */
export const MAX_INVITES_PER_SAVE = 50;
export const TEACHER_NAME_MAX_LENGTH = 40;

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/** 등록에 쓰는 이메일 형태. 앞뒤 공백을 없애고 소문자로 바꾼다. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export interface ParsedEmails {
  /** 등록할 수 있는 이메일(소문자, 겹치지 않음, 적은 순서) */
  emails: string[];
  /** 이메일 모양이 아닌 글 */
  invalid: string[];
}

/** 줄바꿈, 쉼표, 빗금(/), 세미콜론, 공백으로 나눠 적은 이메일을 읽는다. */
export function parseInviteEmails(text: string): ParsedEmails {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;/]+/)) {
    const email = normalizeEmail(part);
    if (email === '') continue;
    if (!isValidEmail(email)) {
      if (!invalid.includes(part)) invalid.push(part);
    } else if (!emails.includes(email)) {
      emails.push(email);
    }
  }
  return { emails, invalid };
}

export interface TeacherInviteDraft {
  emails: readonly string[];
  role: TeacherRole;
}

/** 저장된 역할값을 읽는다. 예전 값(부스 교사, 담임교사, teacher)은 모두 교사다. */
export function toTeacherRole(value: unknown): TeacherRole {
  return value === 'admin' ? 'admin' : 'teacher';
}

export function getTeacherInviteError(draft: TeacherInviteDraft): string | null {
  if (draft.emails.length === 0) return '등록할 Google 계정 이메일을 적어 주세요.';
  if (draft.emails.length > MAX_INVITES_PER_SAVE) {
    return `한 번에 ${MAX_INVITES_PER_SAVE}개까지 등록할 수 있어요.`;
  }
  const wrong = draft.emails.find(
    (email) => email !== normalizeEmail(email) || !isValidEmail(email),
  );
  if (wrong !== undefined) return `이메일 주소를 확인해 주세요: ${wrong}`;
  if (draft.role !== 'admin' && draft.role !== 'teacher') return '역할을 골라 주세요.';
  return null;
}
