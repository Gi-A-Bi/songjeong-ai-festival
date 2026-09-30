import { describe, expect, it } from 'vitest';
import {
  changeGoldenBellKind,
  countGoldenBellKinds,
  getAnswerRevealBlocker,
  getGoldenBellAnswerLabel,
  getGoldenBellConfigError,
  getGoldenBellQuestions,
  getGoldenBellSetsError,
  isGoldenBellAnswered,
  isGoldenBellCorrect,
  isShortAnswerCorrect,
  normalizeGoldenBellConfig,
  normalizeGoldenBellQuestion,
  normalizeShortAnswer,
  toEditableGoldenBellQuestion,
  validateGoldenBellQuestion,
} from './goldenBell';
import type { GoldenBellConfig, GoldenBellQuestion } from './types';

const question: GoldenBellQuestion = {
  id: 'q',
  question: ' AI는 틀릴 수 있을까요? ',
  choices: ['', '예', '  ', '아니요'],
  answerIndex: 3,
  explanation: ' 네 ',
};

const ox: GoldenBellQuestion = {
  id: 'ox',
  kind: 'ox',
  question: '로봇은 사람이 만든 기계다.',
  choices: ['O', 'X'],
  answerIndex: 0,
  explanation: '',
};

const short: GoldenBellQuestion = {
  id: 'short',
  kind: 'short',
  question: '사람처럼 말하는 기계 친구의 이름은?',
  choices: [],
  answerIndex: 0,
  answers: ['말하는 로봇(챗봇)', '챗봇', 'Chat Bot'],
  hint: 'ㅊㅂ',
  level: 'high',
  area: 'AI 이해',
  explanation: '',
};

describe('골든벨 문제 등록', () => {
  it('빈 보기를 빼고 정답 번호를 옮긴다', () => {
    expect(normalizeGoldenBellQuestion(question)).toEqual({
      id: 'q',
      kind: 'choice',
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

  it('O/X 문제는 보기를 O와 X로 고정한다', () => {
    expect(normalizeGoldenBellQuestion({ ...ox, choices: [], answerIndex: 1 })).toEqual({
      id: 'ox',
      kind: 'ox',
      question: '로봇은 사람이 만든 기계다.',
      choices: ['O', 'X'],
      answerIndex: 1,
      explanation: '',
    });
    expect(validateGoldenBellQuestion({ ...ox, answerIndex: 2 })).toEqual({
      answer: '정답을 O와 X 중에서 골라 주세요.',
    });
  });

  it('단답형은 정답이 있어야 하고, 같은 답을 두 번 적으면 하나만 남긴다', () => {
    expect(validateGoldenBellQuestion({ ...short, answers: [' ', ''] })).toEqual({
      answer: '정답을 적어 주세요.',
    });
    expect(
      normalizeGoldenBellQuestion({
        ...short,
        answers: [' 챗봇 ', '챗 봇', 'CHATBOT', 'chat bot'],
      }),
    ).toEqual({
      id: 'short',
      kind: 'short',
      question: '사람처럼 말하는 기계 친구의 이름은?',
      choices: [],
      answerIndex: 0,
      answers: ['챗봇', 'CHATBOT'],
      hint: 'ㅊㅂ',
      level: 'high',
      area: 'AI 이해',
      explanation: '',
    });
  });

  it('저장할 문제에는 값이 없는 칸(undefined)을 넣지 않는다', () => {
    const saved = normalizeGoldenBellQuestion({ ...short, hint: ' ', area: '', level: undefined });
    expect(Object.values(saved)).not.toContain(undefined);
    expect(saved).not.toHaveProperty('hint');
    expect(saved).not.toHaveProperty('area');
    expect(saved).not.toHaveProperty('level');
  });

  it('형식을 바꾸면 문제 글은 남기고 보기와 정답은 새 형식에 맞게 비운다', () => {
    const changed = changeGoldenBellKind(toEditableGoldenBellQuestion(question), 'short');
    expect(changed.kind).toBe('short');
    expect(changed.question).toBe(question.question);
    expect(changed.choices).toEqual([]);
    expect(changed.answers).toEqual([]);
    expect(changeGoldenBellKind(changed, 'ox').choices).toEqual(['O', 'X']);
    expect(changeGoldenBellKind(changed, 'choice').choices).toEqual(['', '', '', '']);
  });
});

describe('단답형 채점', () => {
  it('띄어쓰기, 대소문자, 괄호와 문장 부호의 차이는 틀린 것으로 보지 않는다', () => {
    expect(normalizeShortAnswer(' Chat  Bot! ')).toBe('chatbot');
    expect(normalizeShortAnswer('말하는 로봇(챗봇)')).toBe('말하는로봇챗봇');
    expect(isShortAnswerCorrect(short, '챗 봇')).toBe(true);
    expect(isShortAnswerCorrect(short, 'chatbot')).toBe(true);
    expect(isShortAnswerCorrect(short, '말하는로봇 챗봇')).toBe(true);
  });

  it('빈 답과 다른 답은 틀린 것으로 본다', () => {
    expect(isShortAnswerCorrect(short, '')).toBe(false);
    expect(isShortAnswerCorrect(short, undefined)).toBe(false);
    expect(isShortAnswerCorrect(short, '로봇')).toBe(false);
    // 정답을 등록하지 않은 문제는 무엇을 적어도 맞지 않는다.
    expect(isShortAnswerCorrect({ answers: [] }, '챗봇')).toBe(false);
  });

  it('문제 형식에 맞게 답했는지와 맞았는지를 본다', () => {
    const answer = { selections: { ox: 0, q: 1 }, texts: { short: ' 챗봇 ' } };
    expect(isGoldenBellAnswered(ox, answer)).toBe(true);
    expect(isGoldenBellCorrect(ox, answer)).toBe(true);
    expect(isGoldenBellAnswered(short, answer)).toBe(true);
    expect(isGoldenBellCorrect(short, answer)).toBe(true);
    expect(isGoldenBellAnswered(short, { selections: {}, texts: { short: '  ' } })).toBe(false);
    expect(isGoldenBellAnswered(short, { selections: {} })).toBe(false);
    expect(isGoldenBellCorrect(question, answer)).toBe(false);
  });

  it('화면에는 대표 정답을 보여 준다', () => {
    expect(getGoldenBellAnswerLabel(short)).toBe('말하는 로봇(챗봇)');
    expect(getGoldenBellAnswerLabel(ox)).toBe('O');
    expect(getGoldenBellAnswerLabel(question)).toBe('아니요');
  });
});

describe('학년별 골든벨 문제', () => {
  const common = normalizeGoldenBellQuestion(question);
  const config: GoldenBellConfig = {
    type: 'golden_bell',
    questions: [common],
    gradeQuestions: { 3: [ox, short], 5: [] },
  };

  it('학년별 문제를 등록한 학년은 그 문제를, 나머지는 공통 문제를 푼다', () => {
    expect(getGoldenBellQuestions(config, 3)).toEqual([ox, short]);
    expect(getGoldenBellQuestions(config, 4)).toEqual([common]);
    // 빈 목록은 등록하지 않은 것으로 본다.
    expect(getGoldenBellQuestions(config, 5)).toEqual([common]);
    expect(getGoldenBellQuestions(config, null)).toEqual([common]);
    expect(getGoldenBellQuestions({ type: 'golden_bell', questions: [common] }, 6)).toEqual([
      common,
    ]);
  });

  it('모든 학년이 풀 문제가 있어야 저장한다', () => {
    expect(getGoldenBellSetsError(config)).toBe(null);
    expect(getGoldenBellSetsError({ type: 'golden_bell', questions: [] })).toMatch(/1개 이상/);
    expect(
      getGoldenBellSetsError({ type: 'golden_bell', questions: [], gradeQuestions: { 3: [ox] } }),
    ).toMatch(/4학년, 5학년, 6학년이 풀 문제가 없어요/);
    expect(
      getGoldenBellSetsError({
        type: 'golden_bell',
        questions: [],
        gradeQuestions: { 3: [ox], 4: [ox], 5: [ox], 6: [ox] },
      }),
    ).toBe(null);
  });

  it('어느 학년의 몇 번 문제가 잘못됐는지 알려 준다', () => {
    expect(
      getGoldenBellSetsError({
        ...config,
        gradeQuestions: { 3: [ox, { ...short, answers: [] }] },
      }),
    ).toBe('3학년 2번 문제: 정답을 적어 주세요.');
    expect(getGoldenBellSetsError({ ...config, questions: [{ ...common, question: '' }] })).toBe(
      '공통 문제 1번 문제: 문제를 적어 주세요.',
    );
  });

  it('저장할 때 빈 학년은 빼서 공통 문제를 쓰게 한다', () => {
    const saved = normalizeGoldenBellConfig(config);
    expect(Object.keys(saved.gradeQuestions ?? {})).toEqual(['3']);
    expect(saved.questions).toEqual([common]);
  });

  it('형식별 문제 수를 센다', () => {
    expect(countGoldenBellKinds([ox, short, common, ox])).toEqual({
      total: 4,
      ox: 2,
      choice: 1,
      short: 1,
    });
  });
});

describe('정답 공개 시점', () => {
  const base = { submittedCount: 3, expectedCount: 5, finalized: false };

  it('게임을 시작하기 전에는 공개할 수 없다', () => {
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'ready' })).toMatch(/게임을 시작한 뒤/);
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'open' })).toMatch(/게임을 시작한 뒤/);
  });

  it('게임 중에는 모든 팀이 제출해야 공개할 수 있다', () => {
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'active' })).toMatch(/제출 3\/5팀/);
    expect(
      getAnswerRevealBlocker({ ...base, boothStatus: 'active', submittedCount: 5 }),
    ).toBeNull();
  });

  it('게임 시간이 끝났거나 순위를 확정했으면 공개할 수 있다', () => {
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'scoring' })).toBeNull();
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'completed' })).toBeNull();
    expect(getAnswerRevealBlocker({ ...base, boothStatus: 'active', finalized: true })).toBeNull();
  });
});
