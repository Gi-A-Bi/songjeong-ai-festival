import { describe, expect, it } from 'vitest';
import {
  getLibraryCheckAnswerKeyError,
  getLibraryCheckConfigError,
  hasLibraryCheckAnswerKey,
  LIBRARY_CHECK_MAX_SCORE,
  normalizeLibraryCheckConfig,
  scoreLibraryCheck,
  splitKeywords,
} from './libraryCheck';
import { calculateAutoScore, isTeacherJudged } from './scoring';
import type { LibraryCheckAnswer, LibraryCheckConfig } from './types';

const config: LibraryCheckConfig = {
  type: 'library_check',
  passageTitle: 'AI가 쓴 “꿀벌” 소개 글',
  passage: '꿀벌은 다리가 8개인 곤충이에요.',
  answerKey: {
    wrongPartKeywords: ['다리가 8개', '8개'],
    correctionKeywords: ['6개', '여섯 개'],
    bookTitles: ['신기한 곤충 백과'],
    pageFrom: 20,
    pageTo: 25,
  },
};

const answer: LibraryCheckAnswer = {
  type: 'library_check',
  wrongPart: '꿀벌은 다리가 8개인 곤충이에요',
  correction: '곤충인 꿀벌의 다리는 6 개예요.',
  bookTitle: '신기한 곤충 백과 (개정판)',
  page: 22,
};

describe('도서관 오류찾기 자동 채점', () => {
  it('네 항목을 따로 채점해 합한다', () => {
    expect(scoreLibraryCheck(config, answer)).toEqual({
      total: LIBRARY_CHECK_MAX_SCORE,
      items: { wrongPart: true, correction: true, bookTitle: true, page: true },
    });
    expect(calculateAutoScore(config, answer)).toBe(100);
  });

  it('인정하는 말이 없거나 쪽수가 범위 밖이면 그 항목만 0점이다', () => {
    const result = scoreLibraryCheck(config, {
      ...answer,
      correction: '다리가 많아요',
      bookTitle: '곤충 이야기',
      page: 30,
    });
    expect(result).toEqual({
      total: 30,
      items: { wrongPart: true, correction: false, bookTitle: false, page: false },
    });
  });

  it('띄어쓰기·대소문자·문장 부호가 달라도 같은 말로 본다', () => {
    const result = scoreLibraryCheck(
      { ...config, answerKey: { ...config.answerKey!, bookTitles: ['AI 백과'] } },
      { ...answer, wrongPart: '다 리 가 8 개!', bookTitle: 'ai백과' },
    );
    expect(result?.items.wrongPart).toBe(true);
    expect(result?.items.bookTitle).toBe(true);
  });

  it('정답을 등록하지 않았으면 채점하지 않고 선생님 판정으로 본다', () => {
    const plain: LibraryCheckConfig = {
      type: 'library_check',
      passageTitle: '글',
      passage: '본문',
    };
    expect(scoreLibraryCheck(plain, answer)).toBeNull();
    expect(calculateAutoScore(plain, answer)).toBeNull();
    expect(hasLibraryCheckAnswerKey(plain)).toBe(false);
    expect(isTeacherJudged({ teacherJudged: true, config: plain })).toBe(true);
    expect(isTeacherJudged({ teacherJudged: true, config })).toBe(false);
  });

  it('정답 등록 내용을 검사한다', () => {
    expect(getLibraryCheckAnswerKeyError(config.answerKey!)).toBeNull();
    expect(
      getLibraryCheckAnswerKeyError({ ...config.answerKey!, wrongPartKeywords: [' '] }),
    ).toMatch(/틀린 부분/);
    expect(getLibraryCheckAnswerKeyError({ ...config.answerKey!, pageFrom: null })).toMatch(/쪽수/);
    expect(getLibraryCheckAnswerKeyError({ ...config.answerKey!, pageTo: 10 })).toMatch(
      /마지막 쪽수/,
    );
    expect(getLibraryCheckConfigError({ ...config, passage: ' ' })).toMatch(/본문/);
  });

  it('쉼표로 나눠 적은 말을 목록으로 바꾸고, 모두 비우면 정답 없이 저장한다', () => {
    expect(splitKeywords('6개, 여섯 개,, 6 개')).toEqual(['6개', '여섯 개']);
    const normalized = normalizeLibraryCheckConfig({
      ...config,
      answerKey: {
        wrongPartKeywords: [],
        correctionKeywords: [],
        bookTitles: [],
        pageFrom: null,
        pageTo: null,
      },
    });
    expect(normalized.answerKey).toBeUndefined();
    expect(normalizeLibraryCheckConfig(config).answerKey?.bookTitles).toEqual(['신기한 곤충 백과']);
  });
});
