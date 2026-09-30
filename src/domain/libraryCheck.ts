import { normalizeShortAnswer } from './goldenBell';
import type { LibraryCheckAnswer, LibraryCheckAnswerKey, LibraryCheckConfig } from './types';

/** 네 항목의 배점. 합이 100점이다. */
export const LIBRARY_CHECK_POINTS = {
  wrongPart: 30,
  correction: 40,
  bookTitle: 20,
  page: 10,
} as const;

export type LibraryCheckItem = keyof typeof LIBRARY_CHECK_POINTS;

export const LIBRARY_CHECK_ITEMS: readonly LibraryCheckItem[] = [
  'wrongPart',
  'correction',
  'bookTitle',
  'page',
];

export const LIBRARY_CHECK_ITEM_LABELS: Record<LibraryCheckItem, string> = {
  wrongPart: '틀린 부분',
  correction: '올바른 내용',
  bookTitle: '책 제목',
  page: '쪽수',
};

export const LIBRARY_CHECK_MAX_SCORE = Object.values(LIBRARY_CHECK_POINTS).reduce(
  (sum, points) => sum + points,
  0,
);

export function emptyLibraryCheckAnswerKey(): LibraryCheckAnswerKey {
  return {
    wrongPartKeywords: [],
    correctionKeywords: [],
    bookTitles: [],
    pageFrom: null,
    pageTo: null,
  };
}

/** 정답이 등록되어 자동으로 채점할 수 있는지 */
export function hasLibraryCheckAnswerKey(
  config: Pick<LibraryCheckConfig, 'answerKey'>,
): config is LibraryCheckConfig & { answerKey: LibraryCheckAnswerKey } {
  return config.answerKey !== undefined && getLibraryCheckAnswerKeyError(config.answerKey) === null;
}

/** 쉼표로 나눠 적은 말을 목록으로 바꾼다. 빈 칸과 겹치는 말은 뺀다. */
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of text.split(/[,，、\n]/u)) {
    const keyword = raw.trim();
    const key = normalizeShortAnswer(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

/** 학생이 적은 글에 인정하는 말이 하나라도 들어 있으면 맞은 것으로 본다. */
export function containsKeyword(text: string, keywords: readonly string[]): boolean {
  const given = normalizeShortAnswer(text);
  if (!given) return false;
  return keywords.some((keyword) => {
    const key = normalizeShortAnswer(keyword);
    return key.length > 0 && given.includes(key);
  });
}

/** 책 제목은 부제나 괄호가 붙어도 인정한다(서로 포함하면 같은 책으로 본다). */
export function matchesBookTitle(title: string, titles: readonly string[]): boolean {
  const given = normalizeShortAnswer(title);
  if (!given) return false;
  return titles.some((candidate) => {
    const key = normalizeShortAnswer(candidate);
    return key.length > 0 && (given.includes(key) || key.includes(given));
  });
}

export function isPageInRange(
  page: number,
  key: Pick<LibraryCheckAnswerKey, 'pageFrom' | 'pageTo'>,
): boolean {
  if (key.pageFrom === null) return false;
  const to = key.pageTo ?? key.pageFrom;
  return Number.isInteger(page) && page >= key.pageFrom && page <= to;
}

export interface LibraryCheckScore {
  total: number;
  items: Record<LibraryCheckItem, boolean>;
}

/** 네 항목을 따로 채점해 합한다. 정답이 없으면 채점하지 않는다(null). */
export function scoreLibraryCheck(
  config: Pick<LibraryCheckConfig, 'answerKey'>,
  answer: Pick<LibraryCheckAnswer, 'wrongPart' | 'correction' | 'bookTitle' | 'page'>,
): LibraryCheckScore | null {
  if (!hasLibraryCheckAnswerKey(config)) return null;
  const key = config.answerKey;
  const items: Record<LibraryCheckItem, boolean> = {
    wrongPart: containsKeyword(answer.wrongPart, key.wrongPartKeywords),
    correction: containsKeyword(answer.correction, key.correctionKeywords),
    bookTitle: matchesBookTitle(answer.bookTitle, key.bookTitles),
    page: isPageInRange(answer.page, key),
  };
  const total = LIBRARY_CHECK_ITEMS.reduce(
    (sum, item) => sum + (items[item] ? LIBRARY_CHECK_POINTS[item] : 0),
    0,
  );
  return { total, items };
}

/** 정답 등록 내용을 검사한다. 문제가 없으면 null */
export function getLibraryCheckAnswerKeyError(key: LibraryCheckAnswerKey): string | null {
  if (key.wrongPartKeywords.filter((word) => normalizeShortAnswer(word)).length === 0) {
    return '틀린 부분으로 인정할 말을 하나 이상 적어 주세요.';
  }
  if (key.correctionKeywords.filter((word) => normalizeShortAnswer(word)).length === 0) {
    return '올바른 내용으로 인정할 말을 하나 이상 적어 주세요.';
  }
  if (key.bookTitles.filter((title) => normalizeShortAnswer(title)).length === 0) {
    return '확인할 수 있는 책 제목을 하나 이상 적어 주세요.';
  }
  if (key.pageFrom === null || !Number.isInteger(key.pageFrom) || key.pageFrom < 1) {
    return '쪽수는 1 이상의 숫자로 적어 주세요.';
  }
  if (key.pageTo !== null && (!Number.isInteger(key.pageTo) || key.pageTo < key.pageFrom)) {
    return '마지막 쪽수는 첫 쪽수보다 크거나 같아야 해요.';
  }
  return null;
}

/** 지문과 정답 설정 전체를 검사한다. 정답을 비워 두면 선생님이 직접 채점한다. */
export function getLibraryCheckConfigError(config: LibraryCheckConfig): string | null {
  if (!config.passageTitle.trim()) return '글 제목을 적어 주세요.';
  if (!config.passage.trim()) return '글 본문을 적어 주세요.';
  if (config.answerKey === undefined) return null;
  return getLibraryCheckAnswerKeyError(config.answerKey);
}

/** 저장할 설정을 만든다. 정답 항목이 모두 비어 있으면 정답 없이 저장한다. */
export function normalizeLibraryCheckConfig(config: LibraryCheckConfig): LibraryCheckConfig {
  const base: LibraryCheckConfig = {
    type: 'library_check',
    passageTitle: config.passageTitle.trim(),
    passage: config.passage.trim(),
  };
  const key = config.answerKey;
  if (!key) return base;
  const normalized: LibraryCheckAnswerKey = {
    wrongPartKeywords: splitKeywords(key.wrongPartKeywords.join(',')),
    correctionKeywords: splitKeywords(key.correctionKeywords.join(',')),
    bookTitles: splitKeywords(key.bookTitles.join(',')),
    pageFrom: key.pageFrom,
    pageTo: key.pageTo,
  };
  const empty =
    normalized.wrongPartKeywords.length === 0 &&
    normalized.correctionKeywords.length === 0 &&
    normalized.bookTitles.length === 0 &&
    normalized.pageFrom === null &&
    normalized.pageTo === null;
  return empty ? base : { ...base, answerKey: normalized };
}
