import { normalizeShortAnswer } from './goldenBell';
import type {
  Grade,
  LibraryCheckAnswer,
  LibraryCheckConfig,
  LibraryChooseQuestion,
  LibraryFindQuestion,
  LibraryQuestion,
  LibraryQuestionAnswer,
  LibraryQuestionType,
} from './types';

/** 한 문제의 배점. 찾기(틀린 부분·틀린 문장) 40점 + 바르게 고치기 60점 = 100점 */
export const LIBRARY_QUESTION_POINTS = {
  locate: 40,
  correction: 60,
} as const;

export type LibraryCheckItem = keyof typeof LIBRARY_QUESTION_POINTS;

export const LIBRARY_CHECK_ITEMS: readonly LibraryCheckItem[] = ['locate', 'correction'];

export const LIBRARY_QUESTION_MAX_SCORE = Object.values(LIBRARY_QUESTION_POINTS).reduce(
  (sum, points) => sum + points,
  0,
);

export const LIBRARY_QUESTION_TYPE_LABELS: Record<LibraryQuestionType, string> = {
  find: '서술형',
  choose: '선택형',
};

/** 학년별 문제를 둘 수 있는 학년 */
export const LIBRARY_GRADES: readonly Grade[] = [3, 4, 5, 6];

/** 주제 배지로 자주 쓰는 말. 교사는 다른 말을 적어도 된다. */
export const LIBRARY_SUBJECTS: readonly string[] = ['과학', '역사', '우리말', '예술', '사회'];

/**
 * 학생에게 보여 주는 이야기와 경고. 게임 전 가림막, 게임 중 화면, 교사 부스에 같은 글을 쓴다.
 * 이야기: AI가 알려 준 정보에 오류가 있었고, 진짜 책을 찾아 틀린 곳을 고친다.
 * "문제 유형 고르기" 같은 말은 쓰지 않고, AI에게 한 질문 가운데 조사할 답을 고르는 것으로 말한다.
 */
export const LIBRARY_STORY = {
  title: 'AI가 알려 준 정보, 믿어도 될까요?',
  intro: 'AI에게 물어봤더니 그럴듯한 글을 써 줬어요. 그런데 그 글에는 틀린 내용이 숨어 있어요!',
  task: '도서관 책을 펴서 진짜 사실을 찾고, 틀린 곳을 바르게 고쳐 주세요.',
  warning:
    '디벗·스마트폰·인터넷 검색으로 답을 찾으면 부정행위예요. 적발되면 이 미션에서 바로 탈락해요.',
  choose: 'AI에게 한 질문마다 그럴듯한 답이 돌아왔어요. 어느 답을 조사할까요?',
  chooseLock: '한 번 고르면 바꿀 수 없어요. 신중하게 골라요!',
} as const;

/** 선택형 문장 앞에 붙이는 번호 */
const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export function circledNumber(index: number): string {
  return CIRCLED_NUMBERS[index] ?? `${index + 1}.`;
}

/** 채점 항목의 이름. 찾기 항목은 문제 유형에 따라 다르게 부른다. */
export function getLibraryItemLabel(type: LibraryQuestionType, item: LibraryCheckItem): string {
  if (item === 'correction') return '바르게 고친 내용';
  return type === 'choose' ? '틀린 문장' : '틀린 부분';
}

/** 조사할 답을 고르는 카드에 보여 주는 질문. 따로 적지 않았으면 글 제목을 쓴다. */
export function getLibraryPrompt(question: Pick<LibraryQuestion, 'prompt' | 'title'>): string {
  return question.prompt?.trim() || question.title;
}

/** 그 학년이 푸는 문제. 학년별 문제를 등록하지 않은 학년은 공통 문제를 쓴다. */
export function getLibraryQuestions(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions'>,
  grade: Grade | null,
): LibraryQuestion[] {
  const own = grade === null ? undefined : config.gradeQuestions?.[grade];
  return own && own.length > 0 ? own : config.questions;
}

/** 학년별 문제를 따로 등록한 학년 */
export function getLibraryOwnGrades(config: Pick<LibraryCheckConfig, 'gradeQuestions'>): Grade[] {
  return LIBRARY_GRADES.filter((grade) => (config.gradeQuestions?.[grade]?.length ?? 0) > 0);
}

/** 학생이 그 학년 문제 가운데 하나만 골라 푸는 방식인지(문제가 둘 이상일 때만 고른다) */
export function isLibraryPickOne(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions' | 'pickOne'>,
  grade: Grade | null,
): boolean {
  return config.pickOne === true && getLibraryQuestions(config, grade).length > 1;
}

/**
 * 채점에 들어가는 문제. 하나만 고르는 방식이면 학생이 고른 문제(기록이 없으면 답을 적은 첫 문제)만,
 * 아니면 그 학년의 모든 문제다.
 */
export function getScoredLibraryQuestions(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions' | 'pickOne'>,
  answer: Pick<LibraryCheckAnswer, 'answers' | 'chosenQuestionId'>,
  grade: Grade | null,
): LibraryQuestion[] {
  const questions = getLibraryQuestions(config, grade);
  if (!isLibraryPickOne(config, grade)) return questions;
  const chosen =
    questions.find((question) => question.id === answer.chosenQuestionId) ??
    questions.find((question) => answer.answers[question.id] !== undefined);
  return chosen ? [chosen] : [];
}

/** 등록된 모든 문제 묶음(공통 + 학년별). 비어 있는 묶음은 뺀다. */
function getQuestionSets(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions'>,
): LibraryQuestion[][] {
  const sets = [config.questions];
  for (const grade of LIBRARY_GRADES) {
    const own = config.gradeQuestions?.[grade];
    if (own && own.length > 0) sets.push(own);
  }
  return sets.filter((set) => set.length > 0);
}

/** 그 학년의 만점. 하나만 고르는 방식이거나 학년당 1문제면 100점이다. */
export function getLibraryCheckMaxScore(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions' | 'pickOne'>,
  grade: Grade | null = null,
): number {
  const count = getLibraryQuestions(config, grade).length;
  if (count === 0) return 0;
  return (isLibraryPickOne(config, grade) ? 1 : count) * LIBRARY_QUESTION_MAX_SCORE;
}

/** 등록된 모든 문제에 정답이 있어 자동으로 채점할 수 있는지 */
export function hasLibraryCheckAnswerKey(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions'>,
): boolean {
  const sets = getQuestionSets(config);
  return (
    sets.length > 0 &&
    sets.every((set) =>
      set.every(
        (question) =>
          question.answerKey !== undefined && getLibraryQuestionError(question) === null,
      ),
    )
  );
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
export function containsKeyword(text: string | undefined, keywords: readonly string[]): boolean {
  const given = normalizeShortAnswer(text ?? '');
  if (!given) return false;
  return keywords.some((keyword) => {
    const key = normalizeShortAnswer(keyword);
    return key.length > 0 && given.includes(key);
  });
}

/** 한 줄에 한 문장씩 적은 글을 문장 목록으로 바꾼다. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface LibraryQuestionScore {
  total: number;
  items: Record<LibraryCheckItem, boolean>;
}

export interface LibraryCheckScore {
  total: number;
  max: number;
  /** 문제 ID별 채점 결과 */
  questions: Record<string, LibraryQuestionScore>;
}

/** 한 문제를 채점한다. 정답이 없으면 채점하지 않는다(null). */
export function scoreLibraryQuestion(
  question: LibraryQuestion,
  answer: LibraryQuestionAnswer | undefined,
): LibraryQuestionScore | null {
  if (question.answerKey === undefined || getLibraryQuestionError(question) !== null) return null;
  const locate =
    question.type === 'find'
      ? containsKeyword(answer?.wrongPart, question.answerKey.wrongPartKeywords)
      : answer?.choice !== undefined && answer.choice === question.answerKey.wrongIndex;
  const correction = containsKeyword(answer?.correction, question.answerKey.correctionKeywords);
  const items = { locate, correction };
  const total = LIBRARY_CHECK_ITEMS.reduce(
    (sum, item) => sum + (items[item] ? LIBRARY_QUESTION_POINTS[item] : 0),
    0,
  );
  return { total, items };
}

/**
 * 채점에 들어가는 문제마다 두 항목을 따로 채점해 합한다.
 * 정답이 없는 문제가 있으면 채점하지 않는다(null). 학년을 모르면(null) 공통 문제로 센다.
 */
export function scoreLibraryCheck(
  config: Pick<LibraryCheckConfig, 'questions' | 'gradeQuestions' | 'pickOne'>,
  answer: Pick<LibraryCheckAnswer, 'answers' | 'chosenQuestionId'>,
  grade: Grade | null = null,
): LibraryCheckScore | null {
  if (!hasLibraryCheckAnswerKey(config)) return null;
  const scores: Record<string, LibraryQuestionScore> = {};
  let total = 0;
  for (const question of getScoredLibraryQuestions(config, answer, grade)) {
    const score = scoreLibraryQuestion(question, answer.answers[question.id]);
    if (!score) return null;
    scores[question.id] = score;
    total += score.total;
  }
  return { total, max: getLibraryCheckMaxScore(config, grade), questions: scores };
}

/** 학생이 그 문제의 답을 모두 적었는지 */
export function isLibraryQuestionAnswered(
  question: LibraryQuestion,
  answer: LibraryQuestionAnswer | undefined,
): boolean {
  if (!answer || !answer.correction.trim()) return false;
  if (question.type === 'find') return Boolean(answer.wrongPart?.trim());
  return (
    answer.choice !== undefined &&
    Number.isInteger(answer.choice) &&
    answer.choice >= 0 &&
    answer.choice < question.sentences.length
  );
}

/** 문제 하나를 검사한다. 정답은 있을 때만 검사하고, 문제가 없으면 null */
export function getLibraryQuestionError(question: LibraryQuestion): string | null {
  if (!question.title.trim()) return '글 제목을 적어 주세요.';
  if (question.type === 'find') {
    if (!question.passage.trim()) return '글 본문을 적어 주세요.';
    const key = question.answerKey;
    if (key === undefined) return null;
    if (key.wrongPartKeywords.filter((word) => normalizeShortAnswer(word)).length === 0) {
      return '틀린 부분으로 인정할 말을 하나 이상 적어 주세요.';
    }
    if (key.correctionKeywords.filter((word) => normalizeShortAnswer(word)).length === 0) {
      return '바르게 고친 내용으로 인정할 말을 하나 이상 적어 주세요.';
    }
    return null;
  }
  const sentences = question.sentences.filter((sentence) => sentence.trim());
  if (sentences.length < 2) return '문장을 두 개 이상 적어 주세요(한 줄에 한 문장).';
  if (sentences.length > CIRCLED_NUMBERS.length) {
    return `문장은 ${CIRCLED_NUMBERS.length}개까지 적을 수 있어요.`;
  }
  const key = question.answerKey;
  if (key === undefined) return null;
  if (
    !Number.isInteger(key.wrongIndex) ||
    key.wrongIndex < 0 ||
    key.wrongIndex >= sentences.length
  ) {
    return '틀린 문장의 번호를 골라 주세요.';
  }
  if (key.correctionKeywords.filter((word) => normalizeShortAnswer(word)).length === 0) {
    return '바르게 고친 내용으로 인정할 말을 하나 이상 적어 주세요.';
  }
  return null;
}

/** 한 묶음(공통 또는 한 학년)의 문제를 검사한다. */
function getQuestionSetError(questions: readonly LibraryQuestion[], label: string): string | null {
  const ids = new Set<string>();
  for (const [index, question] of questions.entries()) {
    if (!question.id.trim() || ids.has(question.id)) {
      return `${label} ${index + 1}번 문제의 ID가 겹쳐요.`;
    }
    ids.add(question.id);
    const error = getLibraryQuestionError(question);
    if (error) return `${label} ${index + 1}번 문제: ${error}`;
  }
  return null;
}

/**
 * 문제 전체를 검사한다. 공통 문제가 없으면 네 학년 모두 학년별 문제가 있어야 한다.
 * 정답이 없는 문제는 선생님이 직접 채점한다.
 */
export function getLibraryCheckConfigError(config: LibraryCheckConfig): string | null {
  const commonError = getQuestionSetError(config.questions, '공통');
  if (commonError) return commonError;
  for (const grade of LIBRARY_GRADES) {
    const own = config.gradeQuestions?.[grade];
    if (!own) continue;
    const error = getQuestionSetError(own, `${grade}학년`);
    if (error) return error;
  }
  if (config.questions.length === 0) {
    const missing = LIBRARY_GRADES.filter((grade) => !config.gradeQuestions?.[grade]?.length);
    if (missing.length === LIBRARY_GRADES.length) return '문제를 하나 이상 만들어 주세요.';
    if (missing.length > 0) {
      return `공통 문제가 없으면 ${missing.join('·')}학년 문제도 넣어 주세요.`;
    }
  }
  return null;
}

function normalizeBase<T extends LibraryQuestion>(
  question: T,
): Pick<T, 'id' | 'title'> & Partial<Pick<T, 'prompt' | 'subject'>> {
  const prompt = question.prompt?.trim();
  const subject = question.subject?.trim();
  return {
    id: question.id.trim(),
    title: question.title.trim(),
    ...(prompt ? { prompt } : {}),
    ...(subject ? { subject } : {}),
  };
}

function normalizeFindQuestion(question: LibraryFindQuestion): LibraryFindQuestion {
  const base: LibraryFindQuestion = {
    ...normalizeBase(question),
    type: 'find',
    passage: question.passage.trim(),
  };
  const key = question.answerKey;
  if (!key) return base;
  const wrongPartKeywords = splitKeywords(key.wrongPartKeywords.join(','));
  const correctionKeywords = splitKeywords(key.correctionKeywords.join(','));
  if (wrongPartKeywords.length === 0 && correctionKeywords.length === 0) return base;
  return { ...base, answerKey: { wrongPartKeywords, correctionKeywords } };
}

function normalizeChooseQuestion(question: LibraryChooseQuestion): LibraryChooseQuestion {
  const base: LibraryChooseQuestion = {
    ...normalizeBase(question),
    type: 'choose',
    sentences: splitSentences(question.sentences.join('\n')),
  };
  const key = question.answerKey;
  if (!key) return base;
  const correctionKeywords = splitKeywords(key.correctionKeywords.join(','));
  const hasIndex =
    Number.isInteger(key.wrongIndex) &&
    key.wrongIndex >= 0 &&
    key.wrongIndex < base.sentences.length;
  if (!hasIndex && correctionKeywords.length === 0) return base;
  return { ...base, answerKey: { wrongIndex: hasIndex ? key.wrongIndex : -1, correctionKeywords } };
}

function normalizeQuestions(questions: readonly LibraryQuestion[]): LibraryQuestion[] {
  return questions.map((question) =>
    question.type === 'find' ? normalizeFindQuestion(question) : normalizeChooseQuestion(question),
  );
}

/** 저장할 설정을 만든다. 정답 항목이 모두 비어 있는 문제는 정답 없이, 비어 있는 학년 묶음은 빼고 저장한다. */
export function normalizeLibraryCheckConfig(config: LibraryCheckConfig): LibraryCheckConfig {
  const next: LibraryCheckConfig = {
    type: 'library_check',
    questions: normalizeQuestions(config.questions),
  };
  const gradeQuestions: Partial<Record<Grade, LibraryQuestion[]>> = {};
  for (const grade of LIBRARY_GRADES) {
    const own = config.gradeQuestions?.[grade];
    if (own && own.length > 0) gradeQuestions[grade] = normalizeQuestions(own);
  }
  if (Object.keys(gradeQuestions).length > 0) next.gradeQuestions = gradeQuestions;
  if (config.pickOne === true) next.pickOne = true;
  return next;
}

/** 겹치지 않는 새 문제 ID */
export function createLibraryQuestionId(
  questions: readonly Pick<LibraryQuestion, 'id'>[],
  prefix = 'q',
): string {
  const used = new Set(questions.map((question) => question.id));
  let no = questions.length + 1;
  while (used.has(`${prefix}${no}`)) no += 1;
  return `${prefix}${no}`;
}

/** 편집 화면에서 새로 더하는 빈 문제 */
export function createLibraryQuestion(type: LibraryQuestionType, id: string): LibraryQuestion {
  if (type === 'find') return { id, type, title: '', passage: '' };
  return { id, type, title: '', sentences: [] };
}

/** 예전 구조(글 하나 + 책 제목·쪽수)의 문제 ID */
export const LEGACY_LIBRARY_QUESTION_ID = 'q1';
