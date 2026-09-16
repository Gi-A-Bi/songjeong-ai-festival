import { describe, expect, it } from 'vitest';
import {
  getGoldenBellConfigError,
  normalizeGoldenBellQuestion,
  validateGoldenBellQuestion,
} from './goldenBell';
import type { GoldenBellQuestion } from './types';

const question: GoldenBellQuestion = {
  id: 'q',
  question: ' AI는 틀릴 수 있을까요? ',
  choices: ['', '예', '  ', '아니요'],
  answerIndex: 3,
  explanation: ' 네 ',
};

describe('골든벨 문제 등록', () => {
  it('빈 보기를 빼고 정답 번호를 옮긴다', () => {
    expect(normalizeGoldenBellQuestion(question)).toEqual({
      id: 'q',
      question: 'AI는 틀릴 수 있을까요?',
      choices: ['예', '아니요'],
      answerIndex: 1,
      explanation: '네',
    });
  });

  it('문제·보기·정답이 비면 알려 준다', () => {
    expect(
      validateGoldenBellQuestion({
        ...question,
        question: '',
        choices: ['예', '', '', ''],
        answerIndex: 1,
      }),
    ).toEqual({
      question: '문제를 적어 주세요.',
      choices: '보기를 2개 이상 적어 주세요.',
      answer: '내용이 있는 보기를 정답으로 골라 주세요.',
    });
    expect(validateGoldenBellQuestion(question)).toEqual({});
  });

  it('문제가 없거나 ID가 겹치면 저장하지 않는다', () => {
    expect(getGoldenBellConfigError([])).toMatch(/1개 이상/);
    expect(getGoldenBellConfigError([question, question])).toMatch(/2번 문제의 ID/);
    expect(getGoldenBellConfigError([question])).toBe(null);
  });
});
