import { describe, expect, it } from 'vitest';
import {
  getTeacherInviteError,
  MAX_INVITES_PER_SAVE,
  parseInviteEmails,
  toTeacherRole,
} from './teacherInvites';

describe('교사 등록 이메일 읽기', () => {
  it('빗금, 쉼표, 줄바꿈, 공백으로 나눠 적은 이메일을 읽는다', () => {
    const { emails, invalid } = parseInviteEmails(
      'one@example.com / two@example.com,three@example.com\nfour@example.com;five@example.com',
    );
    expect(emails).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
      'five@example.com',
    ]);
    expect(invalid).toEqual([]);
  });

  it('소문자로 바꾸고 겹치는 이메일은 한 번만 넣는다', () => {
    expect(parseInviteEmails('Teacher@Example.com teacher@example.com').emails).toEqual([
      'teacher@example.com',
    ]);
  });

  it('이메일 모양이 아닌 글은 따로 알려 준다', () => {
    const { emails, invalid } = parseInviteEmails('ok@example.com, 홍길동, no-at.example.com');
    expect(emails).toEqual(['ok@example.com']);
    expect(invalid).toEqual(['홍길동', 'no-at.example.com']);
  });
});

describe('교사 등록 확인', () => {
  const draft = { emails: ['one@example.com'], role: 'teacher' as const };

  it('이메일이 없거나 너무 많으면 등록하지 않는다', () => {
    expect(getTeacherInviteError({ ...draft, emails: [] })).toMatch(/이메일을 적어/);
    const many = Array.from(
      { length: MAX_INVITES_PER_SAVE + 1 },
      (_, index) => `t${index}@example.com`,
    );
    expect(getTeacherInviteError({ ...draft, emails: many })).toMatch(/50개까지/);
    expect(getTeacherInviteError(draft)).toBeNull();
    expect(getTeacherInviteError({ ...draft, role: 'admin' })).toBeNull();
  });

  it('소문자가 아니거나 모양이 틀린 이메일은 받지 않는다', () => {
    expect(getTeacherInviteError({ ...draft, emails: ['One@example.com'] })).toMatch(/확인/);
    expect(getTeacherInviteError({ ...draft, emails: ['a/b@example.com'] })).toMatch(/확인/);
  });
});

describe('역할 읽기', () => {
  it('총괄이 아니면 모두 교사다. 예전의 부스 교사·담임교사도 교사로 읽는다', () => {
    expect(toTeacherRole('admin')).toBe('admin');
    expect(toTeacherRole('teacher')).toBe('teacher');
    expect(toTeacherRole('station_teacher')).toBe('teacher');
    expect(toTeacherRole('homeroom_teacher')).toBe('teacher');
    expect(toTeacherRole(undefined)).toBe('teacher');
  });
});
