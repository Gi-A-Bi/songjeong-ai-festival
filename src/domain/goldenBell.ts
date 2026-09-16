import type { GoldenBellQuestion } from './types';

export const GOLDEN_BELL_RECOMMENDED_QUESTIONS = 7;
export const GOLDEN_BELL_MAX_CHOICES = 4;
export const GOLDEN_BELL_MIN_CHOICES = 2;

export function createGoldenBellQuestionId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyGoldenBellQuestion(): GoldenBellQuestion {
  return {
    id: createGoldenBellQuestionId(),
    question: '',
    choices: Array.from({ length: GOLDEN_BELL_MAX_CHOICES }, () => ''),
    answerIndex: 0,
    explanation: '',
  };
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

/** 저장 전에 공백을 정리하고 빈 보기를 빼며, 정답 번호를 빈 보기 제거에 맞춰 옮긴다. */
export function normalizeGoldenBellQuestion(question: GoldenBellQuestion): GoldenBellQuestion {
  const kept: string[] = [];
  let answerIndex = 0;
  question.choices.forEach((choice, index) => {
    const text = choice.trim();
    if (!text) return;
    if (index === question.answerIndex) answerIndex = kept.length;
    kept.push(text);
  });
  return {
    id: question.id,
    question: question.question.trim(),
    choices: kept,
    answerIndex,
    explanation: question.explanation.trim(),
  };
}

/** 편집 화면은 보기 칸을 항상 4개 보여 준다. */
export function toEditableGoldenBellQuestion(question: GoldenBellQuestion): GoldenBellQuestion {
  const choices = [...question.choices];
  while (choices.length < GOLDEN_BELL_MAX_CHOICES) choices.push('');
  return { ...question, choices: choices.slice(0, GOLDEN_BELL_MAX_CHOICES) };
}

/** 저장할 문제 목록 전체를 검사한다. 문제가 없으면 null */
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
