import {
  getGoldenBellConfigError,
  GOLDEN_BELL_GRADES,
  GOLDEN_BELL_MAX_CHOICES,
  normalizeGoldenBellQuestion,
} from './goldenBell';
import type {
  GoldenBellConfig,
  GoldenBellLevel,
  GoldenBellQuestion,
  GoldenBellQuestionKind,
  Grade,
} from './types';

/*
 * 교사가 올리는 골든벨 문제 파일(JSON)의 형식과 검사.
 * 파일은 scripts/build-golden-upload.mjs가 content/작성/01-골든벨.md에서 만든다.
 * 정답이 들어 있으므로 파일 자체는 공개 저장소에 두지 않는다.
 */

export const GOLDEN_UPLOAD_FORMAT = 'songjeong-golden-bell-questions';
export const GOLDEN_UPLOAD_VERSION = 1;
/** 한 묶음에 넣을 수 있는 문제 수. 미션 문서 하나에 네 학년 문제가 함께 들어간다. */
export const GOLDEN_UPLOAD_MAX_QUESTIONS = 30;

export interface GoldenBellUploadSet {
  /** 이 문제를 푸는 학년. 비어 있으면 학년 공통 문제다. */
  grades: Grade[];
  questions: GoldenBellQuestion[];
}

export interface GoldenBellUploadResult {
  /** 형식이 맞는 문제 묶음. errors가 있으면 비어 있다. */
  sets: GoldenBellUploadSet[];
  errors: string[];
}

const KIND_BY_LABEL: Record<string, GoldenBellQuestionKind> = {
  ox: 'ox',
  'o/x': 'ox',
  choice: 'choice',
  객관식: 'choice',
  short: 'short',
  단답형: 'short',
};

const LEVEL_BY_LABEL: Record<string, GoldenBellLevel> = {
  low: 'low',
  하: 'low',
  mid: 'mid',
  중: 'mid',
  high: 'high',
  상: 'high',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item) => item.length > 0) : [];
}

export function getGoldenBellSetLabel(grades: readonly Grade[]): string {
  return grades.length === 0 ? '공통' : `${grades.join('·')}학년`;
}

function parseGrades(value: unknown): Grade[] | null {
  if (!Array.isArray(value)) return null;
  const grades: Grade[] = [];
  for (const item of value) {
    const grade = GOLDEN_BELL_GRADES.find((candidate) => candidate === Number(item));
    if (grade === undefined) return null;
    if (!grades.includes(grade)) grades.push(grade);
  }
  return grades.sort((a, b) => a - b);
}

function parseChoiceNo(value: unknown, count: number): number | null {
  const circled = '①②③④'.indexOf(text(value));
  const no = circled >= 0 ? circled + 1 : Number(text(value).replace(/번$/u, ''));
  return Number.isInteger(no) && no >= 1 && no <= count ? no : null;
}

function parseQuestion(raw: unknown, label: string, errors: string[]): GoldenBellQuestion | null {
  if (!isRecord(raw)) {
    errors.push(`${label}: 형식이 잘못됐어요.`);
    return null;
  }
  const before = errors.length;
  const kind = KIND_BY_LABEL[text(raw.kind).toLowerCase()];
  if (!kind) errors.push(`${label}: 형식은 O/X, 객관식, 단답형 중 하나여야 해요.`);
  const question = text(raw.question);
  if (!question) errors.push(`${label}: 문제 글이 없어요.`);
  const levelText = text(raw.level);
  const level = levelText ? LEVEL_BY_LABEL[levelText.toLowerCase()] : undefined;
  if (levelText && !level) errors.push(`${label}: 난이도는 하·중·상 중 하나여야 해요.`);

  const parsed: GoldenBellQuestion = {
    id: text(raw.id),
    kind,
    question,
    choices: [],
    answerIndex: 0,
    explanation: text(raw.explanation),
    area: text(raw.area),
    level,
  };

  if (kind === 'ox') {
    const answer = text(raw.answer).toUpperCase();
    if (answer !== 'O' && answer !== 'X') errors.push(`${label}: 정답은 O나 X여야 해요.`);
    parsed.answerIndex = answer === 'X' ? 1 : 0;
  } else if (kind === 'choice') {
    const choices = Array.isArray(raw.choices) ? raw.choices.map(text) : [];
    if (choices.length < 2 || choices.length > GOLDEN_BELL_MAX_CHOICES || choices.includes('')) {
      errors.push(`${label}: 보기는 2~${GOLDEN_BELL_MAX_CHOICES}개를 빈칸 없이 적어야 해요.`);
    } else {
      const answer = parseChoiceNo(raw.answer, choices.length);
      if (answer === null) errors.push(`${label}: 정답은 보기 번호(1~${choices.length})여야 해요.`);
      parsed.choices = choices;
      parsed.answerIndex = (answer ?? 1) - 1;
    }
  } else if (kind === 'short') {
    const answers = [text(raw.answer), ...textList(raw.accept)].filter((item) => item.length > 0);
    if (answers.length === 0) errors.push(`${label}: 정답이 없어요.`);
    parsed.answers = answers;
    parsed.hint = text(raw.hint);
  }
  return errors.length > before ? null : normalizeGoldenBellQuestion(parsed);
}

/** 올린 파일을 읽어 문제 묶음으로 바꾼다. 고칠 곳이 하나라도 있으면 아무것도 넣지 않는다. */
export function parseGoldenBellUpload(raw: unknown): GoldenBellUploadResult {
  if (!isRecord(raw) || raw.format !== GOLDEN_UPLOAD_FORMAT) {
    return {
      sets: [],
      errors: ['골든벨 문제 파일이 아니에요. npm run golden:build로 만든 파일을 골라 주세요.'],
    };
  }
  if (raw.version !== GOLDEN_UPLOAD_VERSION) {
    return {
      sets: [],
      errors: ['파일 형식 버전이 달라요. npm run golden:build로 다시 만들어 주세요.'],
    };
  }
  if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
    return { sets: [], errors: ['파일에 문제 묶음이 없어요.'] };
  }

  const errors: string[] = [];
  const sets: GoldenBellUploadSet[] = [];
  const taken = new Set<string>();
  raw.sets.forEach((rawSet, setIndex) => {
    const grades = isRecord(rawSet) ? parseGrades(rawSet.grades) : null;
    if (!isRecord(rawSet) || grades === null) {
      errors.push(`${setIndex + 1}번째 묶음: 학년은 3~6 중에서 적어야 해요.`);
      return;
    }
    const label = getGoldenBellSetLabel(grades);
    for (const key of grades.length === 0 ? ['공통'] : grades.map(String)) {
      if (taken.has(key)) errors.push(`${label}: 같은 학년의 문제 묶음이 두 번 들어 있어요.`);
      taken.add(key);
    }
    const rawQuestions = Array.isArray(rawSet.questions) ? rawSet.questions : [];
    if (rawQuestions.length === 0) {
      errors.push(`${label}: 문제가 없어요.`);
      return;
    }
    if (rawQuestions.length > GOLDEN_UPLOAD_MAX_QUESTIONS) {
      errors.push(`${label}: 문제는 ${GOLDEN_UPLOAD_MAX_QUESTIONS}개까지 넣을 수 있어요.`);
      return;
    }
    const prefix = grades.length === 0 ? 'common' : `g${grades.join('')}`;
    const questions = rawQuestions
      .map((rawQuestion, index) => {
        const question = parseQuestion(rawQuestion, `${label} ${index + 1}번 문제`, errors);
        if (!question) return null;
        // 다시 올려도 학생 답이 같은 문제를 따라가도록 묶음과 순서로 ID를 정한다.
        return { ...question, id: question.id || `${prefix}-q${index + 1}` };
      })
      .filter((question): question is GoldenBellQuestion => question !== null);
    if (questions.length === rawQuestions.length) {
      const error = getGoldenBellConfigError(questions);
      if (error) errors.push(`${label} ${error}`);
    }
    sets.push({ grades, questions });
  });
  return errors.length > 0 ? { sets: [], errors } : { sets, errors: [] };
}

/**
 * 올린 묶음을 지금 설정에 넣는다. 파일에 있는 학년(과 공통 문제)만 바꾸고 나머지는 그대로 둔다.
 */
export function applyGoldenBellUpload(
  config: GoldenBellConfig,
  sets: readonly GoldenBellUploadSet[],
): GoldenBellConfig {
  const gradeQuestions: Partial<Record<Grade, GoldenBellQuestion[]>> = {
    ...config.gradeQuestions,
  };
  let questions = config.questions;
  for (const set of sets) {
    if (set.grades.length === 0) questions = set.questions;
    for (const grade of set.grades) gradeQuestions[grade] = set.questions;
  }
  return { type: 'golden_bell', questions, gradeQuestions };
}
