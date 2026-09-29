import { describe, expect, it } from 'vitest';
import { createGoldenUploadFixture } from '../test/goldenUploadFixture';
import { getGoldenBellQuestions, getGoldenBellSetsError } from './goldenBell';
import {
  applyGoldenBellUpload,
  getGoldenBellSetLabel,
  parseGoldenBellUpload,
} from './goldenBellUpload';
import { calculateAutoScore } from './scoring';
import type { GoldenBellConfig } from './types';

const common: GoldenBellConfig = {
  type: 'golden_bell',
  questions: [
    {
      id: 'q1',
      question: '공통 문제',
      choices: ['가', '나'],
      answerIndex: 0,
      explanation: '',
    },
  ],
};

describe('골든벨 문제 파일 읽기', () => {
  it('학년 묶음마다 O/X, 객관식, 단답형 문제를 읽는다', () => {
    const { sets, errors } = parseGoldenBellUpload(createGoldenUploadFixture());
    expect(errors).toEqual([]);
    expect(sets.map((set) => getGoldenBellSetLabel(set.grades))).toEqual(['3학년', '5·6학년']);

    const [ox, choice, short] = sets[0].questions;
    expect(ox).toEqual({
      id: 'g3-q1',
      kind: 'ox',
      question: '로봇 청소기는 스스로 움직이며 청소한다.',
      choices: ['O', 'X'],
      answerIndex: 0,
      explanation: '',
      level: 'low',
      area: 'AI 이해',
    });
    expect(choice.choices).toHaveLength(3);
    expect(choice.answerIndex).toBe(1);
    expect(short.answers).toEqual(['키보드', '자판', 'Keyboard']);
    expect(short.hint).toBe('초성 ㅋㅂㄷ');
    // 난이도를 한글(하·중·상)로 적어도 읽는다.
    expect(sets[1].questions[0].level).toBe('low');
    expect(sets[1].questions[0].answerIndex).toBe(1);
  });

  it('저장소에 넣을 수 없는 값(undefined)을 남기지 않는다', () => {
    const { sets } = parseGoldenBellUpload(createGoldenUploadFixture());
    for (const question of sets.flatMap((set) => set.questions)) {
      expect(Object.values(question)).not.toContain(undefined);
    }
  });

  it('ID가 없으면 묶음과 순서로 정해, 다시 올려도 같은 문제가 같은 ID를 갖는다', () => {
    const raw = createGoldenUploadFixture();
    const withoutIds = {
      ...raw,
      sets: raw.sets.map((set) => ({
        ...set,
        questions: set.questions.map((question) => ({ ...question, id: undefined })),
      })),
    };
    const { sets } = parseGoldenBellUpload(withoutIds);
    expect(sets[0].questions.map((question) => question.id)).toEqual(['g3-q1', 'g3-q2', 'g3-q3']);
    expect(sets[1].questions.map((question) => question.id)).toEqual(['g56-q1', 'g56-q2']);
  });

  it('다른 파일이나 버전이 다른 파일은 받지 않는다', () => {
    expect(parseGoldenBellUpload({ format: 'songjeong-final-questions' }).errors[0]).toMatch(
      /골든벨 문제 파일이 아니에요/,
    );
    expect(parseGoldenBellUpload({ ...createGoldenUploadFixture(), version: 2 }).errors[0]).toMatch(
      /버전이 달라요/,
    );
    expect(parseGoldenBellUpload({ ...createGoldenUploadFixture(), sets: [] }).errors[0]).toMatch(
      /문제 묶음이 없어요/,
    );
  });

  it('고칠 곳을 학년과 문제 번호로 알려 주고, 하나라도 있으면 아무것도 넣지 않는다', () => {
    const raw = createGoldenUploadFixture();
    raw.sets[0].questions[0].answer = '맞음';
    raw.sets[0].questions[1].answer = 4;
    raw.sets[0].questions[2].answer = '';
    raw.sets[0].questions[2].accept = [];
    raw.sets[1].questions[0].question = '';
    const { sets, errors } = parseGoldenBellUpload(raw);
    expect(sets).toEqual([]);
    expect(errors).toEqual([
      '3학년 1번 문제: 정답은 O나 X여야 해요.',
      '3학년 2번 문제: 정답은 보기 번호(1~3)여야 해요.',
      '3학년 3번 문제: 정답이 없어요.',
      '5·6학년 1번 문제: 문제 글이 없어요.',
    ]);
  });

  it('같은 학년이 두 묶음에 들어 있으면 받지 않는다', () => {
    const raw = createGoldenUploadFixture();
    raw.sets[1].grades = [3, 6];
    expect(parseGoldenBellUpload(raw).errors).toContain(
      '3·6학년: 같은 학년의 문제 묶음이 두 번 들어 있어요.',
    );
  });
});

describe('골든벨 문제 파일 넣기', () => {
  it('파일에 있는 학년만 바꾸고 나머지 학년은 공통 문제를 그대로 쓴다', () => {
    const { sets } = parseGoldenBellUpload(createGoldenUploadFixture());
    const next = applyGoldenBellUpload(common, sets);
    expect(getGoldenBellSetsError(next)).toBe(null);
    expect(getGoldenBellQuestions(next, 3).map((question) => question.id)).toEqual([
      'g3-q1',
      'g3-q2',
      'g3-q3',
    ]);
    expect(getGoldenBellQuestions(next, 4)).toEqual(common.questions);
    expect(getGoldenBellQuestions(next, 5)).toEqual(getGoldenBellQuestions(next, 6));
    expect(getGoldenBellQuestions(next, 6)).toHaveLength(2);
  });

  it('학년에 맞는 문제로 채점한다', () => {
    const { sets } = parseGoldenBellUpload(createGoldenUploadFixture());
    const config = applyGoldenBellUpload(common, sets);
    const answer = {
      type: 'golden_bell' as const,
      selections: { 'g3-q1': 0, 'g3-q2': 1, q1: 0 },
      texts: { 'g3-q3': ' key board ' },
    };
    expect(calculateAutoScore(config, answer, 3)).toBe(300);
    // 4학년은 공통 문제를 푼다.
    expect(calculateAutoScore(config, answer, 4)).toBe(100);
    expect(calculateAutoScore(config, answer, 5)).toBe(0);
  });
});
