import { describe, expect, it } from 'vitest';
import {
  createLibraryQuestionId,
  getLibraryCheckConfigError,
  getLibraryCheckMaxScore,
  getLibraryOwnGrades,
  getLibraryQuestionError,
  getLibraryQuestions,
  hasLibraryCheckAnswerKey,
  isLibraryQuestionAnswered,
  normalizeLibraryCheckConfig,
  scoreLibraryCheck,
  splitKeywords,
  splitSentences,
} from './libraryCheck';
import { calculateAutoScore, isTeacherJudged } from './scoring';
import type {
  LibraryCheckAnswer,
  LibraryCheckConfig,
  LibraryChooseQuestion,
  LibraryFindQuestion,
} from './types';

const find: LibraryFindQuestion = {
  id: 'q1',
  type: 'find',
  title: 'AI가 쓴 “꿀벌” 소개 글',
  passage: '꿀벌은 다리가 8개인 곤충이에요.',
  answerKey: { wrongPartKeywords: ['다리가 8개', '8개'], correctionKeywords: ['6개', '여섯 개'] },
};

const choose: LibraryChooseQuestion = {
  id: 'q2',
  type: 'choose',
  title: 'AI가 쓴 “달” 소개 글',
  sentences: [
    '달은 지구의 위성이에요.',
    '달의 구덩이는 화산 때문에 생겼어요.',
    '달에는 공기가 거의 없어요.',
  ],
  answerKey: { wrongIndex: 1, correctionKeywords: ['운석', '충돌'] },
};

/** 3학년만의 문제. 다른 학년은 공통 문제를 푼다. */
const grade3: LibraryChooseQuestion = {
  id: 'g3q1',
  type: 'choose',
  title: 'AI가 쓴 “자석” 소개 글',
  sentences: ['자석은 철을 끌어당겨요.', '나침반 바늘의 N극은 남쪽을 가리켜요.'],
  answerKey: { wrongIndex: 1, correctionKeywords: ['북쪽'] },
};

const config: LibraryCheckConfig = {
  type: 'library_check',
  questions: [find, choose],
  gradeQuestions: { 3: [grade3] },
};

const answer: LibraryCheckAnswer = {
  type: 'library_check',
  answers: {
    q1: {
      wrongPart: '꿀벌은 다리가 8개인 곤충이에요',
      correction: '곤충인 꿀벌의 다리는 6 개예요.',
    },
    q2: { choice: 1, correction: '운석이 부딪혀서 생긴 구덩이예요.' },
  },
};

describe('도서관 오류찾기 자동 채점', () => {
  it('그 학년이 푸는 문제마다 찾기·고치기를 따로 채점해 합한다', () => {
    expect(getLibraryCheckMaxScore(config, 4)).toBe(200);
    expect(scoreLibraryCheck(config, answer, 4)).toEqual({
      total: 200,
      max: 200,
      questions: {
        q1: { total: 100, items: { locate: true, correction: true } },
        q2: { total: 100, items: { locate: true, correction: true } },
      },
    });
    expect(calculateAutoScore(config, answer, 4)).toBe(200);
  });

  it('학년별 문제가 있는 학년은 그 문제로만 채점한다', () => {
    expect(getLibraryQuestions(config, 3)).toEqual([grade3]);
    expect(getLibraryQuestions(config, 5)).toEqual([find, choose]);
    expect(getLibraryQuestions(config, null)).toEqual([find, choose]);
    expect(getLibraryOwnGrades(config)).toEqual([3]);
    expect(getLibraryCheckMaxScore(config, 3)).toBe(100);
    const third = scoreLibraryCheck(
      config,
      { answers: { g3q1: { choice: 1, correction: '북쪽을 가리켜요' } } },
      3,
    );
    expect(third).toEqual({
      total: 100,
      max: 100,
      questions: { g3q1: { total: 100, items: { locate: true, correction: true } } },
    });
    // 3학년이 공통 문제의 답을 보내도 자기 학년 문제로만 채점한다.
    expect(calculateAutoScore(config, answer, 3)).toBe(0);
  });

  it('인정하는 말이 없거나 다른 문장을 고르면 그 항목만 0점이다', () => {
    const result = scoreLibraryCheck(
      config,
      {
        answers: {
          q1: { wrongPart: '다리가 많아요', correction: '여섯개' },
          q2: { choice: 2, correction: '운석 충돌' },
        },
      },
      4,
    );
    expect(result).toEqual({
      total: 120,
      max: 200,
      questions: {
        q1: { total: 60, items: { locate: false, correction: true } },
        q2: { total: 60, items: { locate: false, correction: true } },
      },
    });
    // 답을 아예 적지 않은 문제는 0점
    expect(scoreLibraryCheck(config, { answers: { q1: answer.answers.q1 } }, 4)?.total).toBe(100);
  });

  it('띄어쓰기·대소문자·문장 부호가 달라도 같은 말로 본다', () => {
    const result = scoreLibraryCheck(
      config,
      { answers: { ...answer.answers, q1: { wrongPart: '다 리 가 8 개!', correction: 'ai 6개' } } },
      4,
    );
    expect(result?.questions.q1.items).toEqual({ locate: true, correction: true });
  });

  it('정답이 없는 문제가 하나라도 있으면 채점하지 않고 선생님 판정으로 본다', () => {
    const plain: LibraryCheckConfig = {
      type: 'library_check',
      questions: [find, { ...choose, answerKey: undefined }],
    };
    expect(scoreLibraryCheck(plain, answer, 4)).toBeNull();
    expect(calculateAutoScore(plain, answer, 4)).toBeNull();
    expect(hasLibraryCheckAnswerKey(plain)).toBe(false);
    expect(hasLibraryCheckAnswerKey({ questions: [] })).toBe(false);
    // 학년별 문제에 정답이 없어도 선생님 판정이다.
    expect(
      hasLibraryCheckAnswerKey({
        questions: [find],
        gradeQuestions: { 3: [{ ...grade3, answerKey: undefined }] },
      }),
    ).toBe(false);
    expect(isTeacherJudged({ teacherJudged: true, config: plain })).toBe(true);
    expect(isTeacherJudged({ teacherJudged: true, config })).toBe(false);
  });

  it('학생이 문제의 답을 모두 적었는지 본다', () => {
    expect(isLibraryQuestionAnswered(find, answer.answers.q1)).toBe(true);
    expect(isLibraryQuestionAnswered(find, { wrongPart: ' ', correction: '6개' })).toBe(false);
    expect(isLibraryQuestionAnswered(choose, { choice: 1, correction: '운석' })).toBe(true);
    expect(isLibraryQuestionAnswered(choose, { choice: 5, correction: '운석' })).toBe(false);
    expect(isLibraryQuestionAnswered(choose, { correction: '운석' })).toBe(false);
  });

  it('문제와 정답 등록 내용을 검사한다', () => {
    expect(getLibraryCheckConfigError(config)).toBeNull();
    expect(getLibraryCheckConfigError({ type: 'library_check', questions: [] })).toMatch(
      /하나 이상/,
    );
    expect(
      getLibraryQuestionError({
        ...find,
        answerKey: { wrongPartKeywords: [' '], correctionKeywords: ['6개'] },
      }),
    ).toMatch(/틀린 부분/);
    expect(getLibraryQuestionError({ ...choose, sentences: ['하나'] })).toMatch(/두 개 이상/);
    expect(
      getLibraryQuestionError({
        ...choose,
        answerKey: { wrongIndex: 7, correctionKeywords: ['운석'] },
      }),
    ).toMatch(/번호/);
    expect(
      getLibraryQuestionError({ ...choose, answerKey: { wrongIndex: 1, correctionKeywords: [] } }),
    ).toMatch(/바르게 고친 내용/);
    expect(
      getLibraryCheckConfigError({ type: 'library_check', questions: [{ ...find, passage: ' ' }] }),
    ).toMatch(/공통 1번 문제: 글 본문/);
    expect(
      getLibraryCheckConfigError({
        type: 'library_check',
        questions: [find, { ...choose, id: 'q1' }],
      }),
    ).toMatch(/ID가 겹쳐요/);
    expect(
      getLibraryCheckConfigError({
        type: 'library_check',
        questions: [],
        gradeQuestions: { 3: [grade3], 4: [{ ...grade3, id: 'g4q1', title: ' ' }] },
      }),
    ).toMatch(/4학년 1번 문제: 글 제목/);
    // 공통 문제가 없으면 네 학년 모두 학년별 문제가 있어야 한다.
    expect(
      getLibraryCheckConfigError({
        type: 'library_check',
        questions: [],
        gradeQuestions: { 3: [grade3], 4: [{ ...grade3, id: 'g4q1' }] },
      }),
    ).toMatch(/5·6학년 문제도 넣어 주세요/);
    expect(
      getLibraryCheckConfigError({
        type: 'library_check',
        questions: [],
        gradeQuestions: {
          3: [grade3],
          4: [{ ...grade3, id: 'g4q1' }],
          5: [{ ...grade3, id: 'g5q1' }],
          6: [{ ...grade3, id: 'g6q1' }],
        },
      }),
    ).toBeNull();
  });

  it('쉼표로 나눈 말과 줄로 나눈 문장을 목록으로 바꾸고, 정답을 모두 비우면 정답 없이 저장한다', () => {
    expect(splitKeywords('6개, 여섯 개,, 6 개')).toEqual(['6개', '여섯 개']);
    expect(splitSentences(' 하나 \n\n둘\n')).toEqual(['하나', '둘']);
    const normalized = normalizeLibraryCheckConfig({
      type: 'library_check',
      questions: [
        { ...find, answerKey: { wrongPartKeywords: [], correctionKeywords: [] } },
        { ...choose, answerKey: { wrongIndex: -1, correctionKeywords: [] } },
      ],
      gradeQuestions: { 3: [], 4: [grade3] },
    });
    expect(normalized.questions.map((question) => question.answerKey)).toEqual([
      undefined,
      undefined,
    ]);
    // 비어 있는 학년 묶음은 빠진다.
    expect(Object.keys(normalized.gradeQuestions ?? {})).toEqual(['4']);
    expect(normalizeLibraryCheckConfig(config).questions[1].answerKey).toEqual({
      wrongIndex: 1,
      correctionKeywords: ['운석', '충돌'],
    });
    expect(
      normalizeLibraryCheckConfig({ type: 'library_check', questions: [find] }).gradeQuestions,
    ).toBeUndefined();
    expect(createLibraryQuestionId(config.questions)).toBe('q3');
    expect(createLibraryQuestionId([{ id: 'q2' }])).toBe('q3');
    expect(createLibraryQuestionId([], 'g3q')).toBe('g3q1');
  });
});
