import type {
  GoldenBellAnswer,
  GoldenBellConfig,
  GoldenBellLevel,
  GoldenBellQuestion,
  GoldenBellQuestionKind,
  Grade,
} from './types';

export const GOLDEN_BELL_RECOMMENDED_QUESTIONS = 15;
export const GOLDEN_BELL_MAX_CHOICES = 4;
export const GOLDEN_BELL_MIN_CHOICES = 2;
/** 학생이 적는 단답형 답의 최대 글자 수 */
export const GOLDEN_BELL_SHORT_MAX_LENGTH = 30;
export const GOLDEN_BELL_GRADES: readonly Grade[] = [3, 4, 5, 6];

/** O/X 문제의 보기. 0번이 O, 1번이 X다. */
export const GOLDEN_BELL_OX_CHOICES: readonly string[] = ['O', 'X'];

export const GOLDEN_BELL_KINDS: readonly GoldenBellQuestionKind[] = ['ox', 'choice', 'short'];

export const GOLDEN_BELL_KIND_LABELS: Record<GoldenBellQuestionKind, string> = {
  ox: 'O/X',
  choice: '객관식',
  short: '단답형',
};

export const GOLDEN_BELL_LEVELS: readonly GoldenBellLevel[] = ['low', 'mid', 'high'];

export const GOLDEN_BELL_LEVEL_LABELS: Record<GoldenBellLevel, string> = {
  low: '하',
  mid: '중',
  high: '상',
};

export function getGoldenBellKind(question: Pick<GoldenBellQuestion, 'kind'>) {
  return question.kind ?? 'choice';
}

/** 그 학년이 푸는 문제. 학년별 문제를 등록하지 않은 학년은 공통 문제를 쓴다. */
export function getGoldenBellQuestions(
  config: GoldenBellConfig,
  grade: Grade | null,
): GoldenBellQuestion[] {
  const own = grade === null ? undefined : config.gradeQuestions?.[grade];
  return own && own.length > 0 ? own : config.questions;
}

/** 학년별 문제를 따로 등록한 학년 */
export function getGoldenBellOwnGrades(config: GoldenBellConfig): Grade[] {
  return GOLDEN_BELL_GRADES.filter((grade) => (config.gradeQuestions?.[grade]?.length ?? 0) > 0);
}

/**
 * 단답형 답을 견주기 좋게 다듬는다.
 * 띄어쓰기, 대소문자, 괄호·문장 부호의 차이는 틀린 것으로 보지 않는다.
 */
export function normalizeShortAnswer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·.,!?'"“”‘’()[\]{}<>〈〉「」~\-_/]/gu, '');
}

export function isShortAnswerCorrect(
  question: Pick<GoldenBellQuestion, 'answers'>,
  text: string | undefined,
): boolean {
  const given = normalizeShortAnswer(text ?? '');
  if (!given) return false;
  return (question.answers ?? []).some((answer) => normalizeShortAnswer(answer) === given);
}

/** 학생이 그 문제에 답했는지 */
export function isGoldenBellAnswered(
  question: GoldenBellQuestion,
  answer: Pick<GoldenBellAnswer, 'selections' | 'texts'>,
): boolean {
  if (getGoldenBellKind(question) === 'short') {
    return (answer.texts?.[question.id] ?? '').trim().length > 0;
  }
  return answer.selections[question.id] !== undefined;
}

export function isGoldenBellCorrect(
  question: GoldenBellQuestion,
  answer: Pick<GoldenBellAnswer, 'selections' | 'texts'>,
): boolean {
  if (getGoldenBellKind(question) === 'short') {
    return isShortAnswerCorrect(question, answer.texts?.[question.id]);
  }
  return answer.selections[question.id] === question.answerIndex;
}

/** 화면에 보여 줄 정답 */
export function getGoldenBellAnswerLabel(question: GoldenBellQuestion): string {
  if (getGoldenBellKind(question) === 'short') return question.answers?.[0] ?? '';
  return question.choices[question.answerIndex] ?? '';
}

export function createGoldenBellQuestionId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyGoldenBellQuestion(
  kind: GoldenBellQuestionKind = 'choice',
): GoldenBellQuestion {
  return toEditableGoldenBellQuestion({
    id: createGoldenBellQuestionId(),
    kind,
    question: '',
    choices: [],
    answerIndex: 0,
    explanation: '',
  });
}

export interface GoldenBellQuestionErrors {
  question?: string;
  choices?: string;
  answer?: string;
}

/** 문제 하나를 검사한다. 문제가 없으면 빈 객체를 돌려준다. */
export function validateGoldenBellQuestion(question: GoldenBellQuestion): GoldenBellQuestionErrors {
  const errors: GoldenBellQuestionErrors = {};
  if (!question.question.trim()) errors.question = '문제를 적어 주세요.';
  const kind = getGoldenBellKind(question);
  if (kind === 'short') {
    const answers = (question.answers ?? []).filter((answer) => normalizeShortAnswer(answer));
    if (answers.length === 0) errors.answer = '정답을 적어 주세요.';
    return errors;
  }
  if (kind === 'ox') {
    if (question.answerIndex !== 0 && question.answerIndex !== 1) {
      errors.answer = '정답을 O와 X 중에서 골라 주세요.';
    }
    return errors;
  }
  const filled = question.choices.filter((choice) => choice.trim()).length;
  if (filled < GOLDEN_BELL_MIN_CHOICES) {
    errors.choices = `보기를 ${GOLDEN_BELL_MIN_CHOICES}개 이상 적어 주세요.`;
  }
  if (!question.choices[question.answerIndex]?.trim()) {
    errors.answer = '내용이 있는 보기를 정답으로 골라 주세요.';
  }
  return errors;
}

export function hasGoldenBellErrors(errors: GoldenBellQuestionErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * 저장 전에 공백을 정리하고 형식에 맞지 않는 칸을 비운다.
 * 객관식은 빈 보기를 빼고 정답 번호를 그에 맞춰 옮긴다.
 * 저장소에 undefined가 들어가지 않게 값이 있는 칸만 담는다.
 */
export function normalizeGoldenBellQuestion(question: GoldenBellQuestion): GoldenBellQuestion {
  const kind = getGoldenBellKind(question);
  const base: GoldenBellQuestion = {
    id: question.id,
    kind,
    question: question.question.trim(),
    choices: [],
    answerIndex: 0,
    explanation: question.explanation.trim(),
  };
  if (question.level) base.level = question.level;
  const area = question.area?.trim();
  if (area) base.area = area;

  if (kind === 'short') {
    const seen = new Set<string>();
    const answers: string[] = [];
    for (const answer of question.answers ?? []) {
      const text = answer.trim();
      const key = normalizeShortAnswer(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      answers.push(text);
    }
    const hint = question.hint?.trim();
    return { ...base, answers, ...(hint ? { hint } : {}) };
  }
  if (kind === 'ox') {
    return {
      ...base,
      choices: [...GOLDEN_BELL_OX_CHOICES],
      answerIndex: question.answerIndex === 1 ? 1 : 0,
    };
  }
  const kept: string[] = [];
  let answerIndex = 0;
  question.choices.forEach((choice, index) => {
    const text = choice.trim();
    if (!text) return;
    if (index === question.answerIndex) answerIndex = kept.length;
    kept.push(text);
  });
  return { ...base, choices: kept, answerIndex };
}

/** 편집 화면은 객관식 보기 칸을 항상 4개, 단답형 정답 칸을 하나 이상 보여 준다. */
export function toEditableGoldenBellQuestion(question: GoldenBellQuestion): GoldenBellQuestion {
  const kind = getGoldenBellKind(question);
  const choices = kind === 'choice' ? [...question.choices] : [];
  while (kind === 'choice' && choices.length < GOLDEN_BELL_MAX_CHOICES) choices.push('');
  return {
    ...question,
    kind,
    choices:
      kind === 'ox' ? [...GOLDEN_BELL_OX_CHOICES] : choices.slice(0, GOLDEN_BELL_MAX_CHOICES),
    answers: question.answers ?? [],
    hint: question.hint ?? '',
    area: question.area ?? '',
  };
}

/**
 * 편집 화면에서 문제 형식을 바꾼다.
 * 문제 글·해설·난이도·영역은 남기고 보기와 정답은 새 형식에 맞게 비운다.
 */
export function changeGoldenBellKind(
  question: GoldenBellQuestion,
  kind: GoldenBellQuestionKind,
): GoldenBellQuestion {
  if (getGoldenBellKind(question) === kind) return question;
  return toEditableGoldenBellQuestion({
    ...question,
    kind,
    choices: [],
    answerIndex: 0,
    answers: [],
    hint: '',
  });
}

/** 문제 목록 하나를 검사한다. 문제가 없으면 null */
export function getGoldenBellConfigError(questions: readonly GoldenBellQuestion[]): string | null {
  if (questions.length === 0) return '문제를 1개 이상 등록해 주세요.';
  const ids = new Set<string>();
  for (const [index, question] of questions.entries()) {
    if (!question.id || ids.has(question.id)) return `${index + 1}번 문제의 ID가 비었거나 겹쳐요.`;
    ids.add(question.id);
    const errors = validateGoldenBellQuestion(question);
    const message = errors.question ?? errors.choices ?? errors.answer;
    if (message) return `${index + 1}번 문제: ${message}`;
  }
  return null;
}

/**
 * 골든벨 설정 전체를 검사한다. 문제가 없으면 null.
 * 모든 학년이 풀 문제가 있어야 한다: 공통 문제가 있거나, 네 학년 모두 학년별 문제가 있어야 한다.
 */
export function getGoldenBellSetsError(config: GoldenBellConfig): string | null {
  const own = getGoldenBellOwnGrades(config);
  if (config.questions.length === 0) {
    const missing = GOLDEN_BELL_GRADES.filter((grade) => !own.includes(grade));
    if (missing.length === GOLDEN_BELL_GRADES.length) return '문제를 1개 이상 등록해 주세요.';
    if (missing.length > 0) {
      return `${missing.map((grade) => `${grade}학년`).join(', ')}이 풀 문제가 없어요. 공통 문제나 학년별 문제를 등록해 주세요.`;
    }
  } else {
    const error = getGoldenBellConfigError(config.questions);
    if (error) return `공통 문제 ${error}`;
  }
  for (const grade of own) {
    const error = getGoldenBellConfigError(config.gradeQuestions?.[grade] ?? []);
    if (error) return `${grade}학년 ${error}`;
  }
  return null;
}

/** 저장할 설정을 만든다. 빈 학년은 빼서 그 학년이 공통 문제를 쓰게 한다. */
export function normalizeGoldenBellConfig(config: GoldenBellConfig): GoldenBellConfig {
  const gradeQuestions: Partial<Record<Grade, GoldenBellQuestion[]>> = {};
  for (const grade of GOLDEN_BELL_GRADES) {
    const questions = config.gradeQuestions?.[grade] ?? [];
    if (questions.length > 0) gradeQuestions[grade] = questions.map(normalizeGoldenBellQuestion);
  }
  return {
    type: 'golden_bell',
    questions: config.questions.map(normalizeGoldenBellQuestion),
    gradeQuestions,
  };
}

export interface GoldenBellKindCounts {
  total: number;
  ox: number;
  choice: number;
  short: number;
}

export function countGoldenBellKinds(
  questions: readonly GoldenBellQuestion[],
): GoldenBellKindCounts {
  const counts: GoldenBellKindCounts = { total: questions.length, ox: 0, choice: 0, short: 0 };
  for (const question of questions) counts[getGoldenBellKind(question)] += 1;
  return counts;
}
