import { describe, expect, it } from 'vitest';
import {
  getLibraryCheckMaxScore,
  getLibraryPrompt,
  getScoredLibraryQuestions,
  isLibraryPickOne,
  normalizeLibraryCheckConfig,
  scoreLibraryCheck,
} from './libraryCheck';
import { calculateAutoScore } from './scoring';
import type { LibraryCheckConfig, LibraryChooseQuestion, LibraryFindQuestion } from './types';

const bee: LibraryFindQuestion = {
  id: 'q1',
  type: 'find',
  title: 'AI가 쓴 “꿀벌” 소개 글',
  prompt: '꿀벌에 대해 알려 줘',
  subject: '과학',
  passage: '꿀벌은 다리가 8개인 곤충이에요.',
  answerKey: { wrongPartKeywords: ['8개'], correctionKeywords: ['6개'] },
};

const moon: LibraryChooseQuestion = {
  id: 'q2',
  type: 'choose',
  title: 'AI가 쓴 “달” 소개 글',
  sentences: ['달은 지구의 위성이에요.', '달의 구덩이는 화산 때문에 생겼어요.'],
  answerKey: { wrongIndex: 1, correctionKeywords: ['운석'] },
};

/** 학생이 질문 하나만 골라 푸는 설정 */
const config: LibraryCheckConfig = {
  type: 'library_check',
  pickOne: true,
  questions: [bee, moon],
  gradeQuestions: { 3: [moon] },
};

describe('도서관 오류찾기: AI에게 한 질문 가운데 하나만 골라 풀기', () => {
  it('문제가 둘 이상인 학년만 고르고, 만점은 고른 문제 하나로 100점이다', () => {
    expect(isLibraryPickOne(config, 4)).toBe(true);
    expect(isLibraryPickOne(config, 3)).toBe(false);
    expect(isLibraryPickOne({ ...config, pickOne: undefined }, 4)).toBe(false);
    expect(getLibraryCheckMaxScore(config, 4)).toBe(100);
    expect(getLibraryCheckMaxScore(config, 3)).toBe(100);
    expect(getLibraryCheckMaxScore({ ...config, pickOne: undefined }, 4)).toBe(200);
    expect(getLibraryCheckMaxScore({ ...config, questions: [] }, 4)).toBe(0);
  });

  it('고른 문제만 채점하고, 고른 기록이 없으면 답을 적은 첫 문제를 채점한다', () => {
    const chosenMoon = {
      chosenQuestionId: 'q2',
      answers: { q2: { choice: 1, correction: '운석이 부딪혀서' } },
    };
    expect(getScoredLibraryQuestions(config, chosenMoon, 4)).toEqual([moon]);
    expect(scoreLibraryCheck(config, chosenMoon, 4)).toEqual({
      total: 100,
      max: 100,
      questions: { q2: { total: 100, items: { locate: true, correction: true } } },
    });
    // 고른 글이 아닌 문제의 답은 점수에 들어가지 않는다.
    expect(
      calculateAutoScore(
        config,
        {
          type: 'library_check',
          chosenQuestionId: 'q2',
          answers: {
            q1: { wrongPart: '8개', correction: '6개' },
            q2: { choice: 0, correction: '모르겠어요' },
          },
        },
        4,
      ),
    ).toBe(0);
    expect(
      scoreLibraryCheck(config, { answers: { q1: { wrongPart: '8개', correction: '6개' } } }, 4),
    ).toMatchObject({ total: 100, max: 100 });
    // 아무것도 고르지 않았으면 0점
    expect(scoreLibraryCheck(config, { answers: {} }, 4)).toEqual({
      total: 0,
      max: 100,
      questions: {},
    });
    // 학년별 문제가 하나뿐인 학년은 고르지 않고 그 문제를 푼다.
    expect(getScoredLibraryQuestions(config, { answers: {} }, 3)).toEqual([moon]);
  });

  it('질문·주제는 다듬어 저장하고, 하나만 고르기는 켰을 때만 남긴다', () => {
    const normalized = normalizeLibraryCheckConfig({
      ...config,
      questions: [
        { ...bee, prompt: '  꿀벌에 대해 알려 줘 ', subject: ' ' },
        { ...moon, prompt: '', subject: '과학' },
      ],
    });
    expect(normalized.pickOne).toBe(true);
    expect(normalized.questions[0]).toMatchObject({ prompt: '꿀벌에 대해 알려 줘' });
    expect(normalized.questions[0]).not.toHaveProperty('subject');
    expect(normalized.questions[1]).not.toHaveProperty('prompt');
    expect(normalized.questions[1]).toMatchObject({ subject: '과학' });
    expect(normalizeLibraryCheckConfig({ ...config, pickOne: false })).not.toHaveProperty(
      'pickOne',
    );
    // 질문을 따로 적지 않은 문제는 글 제목을 카드에 쓴다.
    expect(getLibraryPrompt(bee)).toBe('꿀벌에 대해 알려 줘');
    expect(getLibraryPrompt(moon)).toBe('AI가 쓴 “달” 소개 글');
  });
});
