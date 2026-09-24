import { FINAL_QUESTION_COUNT } from '../config';
import { CARD_TYPES } from './cards';
import { formatBytes } from './drawingFiles';
import { getQuestionSetError } from './finalMission';
import type {
  CardType,
  FinalClassState,
  FinalQuestionConfig,
  FinalQuestionImage,
  FinalQuestionSet,
  FinalSession,
  Grade,
} from './types';

/*
 * 총괄 운영자가 올리는 최종 미션 문제 파일(JSON)의 형식과 검사.
 * 파일은 scripts/build-final-upload.mjs가 content/작성 원고에서 만든다.
 * 정답이 들어 있으므로 파일 자체는 공개 저장소에 두지 않는다.
 */

export const FINAL_UPLOAD_FORMAT = 'songjeong-final-questions';
export const FINAL_UPLOAD_VERSION = 1;
export const FINAL_GRADES: readonly Grade[] = [3, 4, 5, 6];

/** Firestore 문서 한도(1MiB)에 여유를 둔 학년별 문제 묶음 최대 크기 */
export const FINAL_SET_MAX_BYTES = 800_000;
/** 그림 한 장(data URL)의 최대 크기. 넘으면 원고 쪽에서 줄여 온다. */
export const FINAL_IMAGE_MAX_BYTES = 400_000;

const CHOICE_IDS = ['a', 'b', 'c', 'd'] as const;

/** 원고에서 영역을 한글로 적어도 받는다. */
const AREA_BY_LABEL: Record<string, CardType> = {
  생각: 'thinking',
  관찰: 'observation',
  표현: 'expression',
  명령: 'command',
  검증: 'verification',
};

export interface FinalQuestionUploadResult {
  /** 형식이 맞는 학년 묶음. errors가 있으면 비어 있다. */
  sets: FinalQuestionSet[];
  errors: string[];
}

export interface FinalQuestionSetStats {
  grade: Grade;
  questionCount: number;
  imageCount: number;
  /** JSON으로 잰 대략의 크기(바이트) */
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseArea(value: unknown): CardType | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((CARD_TYPES as readonly string[]).includes(trimmed)) return trimmed as CardType;
  return AREA_BY_LABEL[trimmed.replace(/\s*(영역|카드)$/u, '')] ?? null;
}

function parseChoiceNo(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4)
    return value;
  if (typeof value === 'string') {
    const circled = '①②③④'.indexOf(value.trim());
    if (circled >= 0) return circled + 1;
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) return parsed;
  }
  return null;
}

/** 그림은 data URL(원고에서 넣은 파일)이나 앱 안의 경로만 받는다. */
function parseImage(value: unknown, label: string, errors: string[]): FinalQuestionImage | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.src !== 'string' || value.src.trim().length === 0) {
    errors.push(`${label}: 그림 정보가 잘못됐어요(src가 없어요).`);
    return null;
  }
  const src = value.src.trim();
  const allowed = src.startsWith('data:image/') || src.startsWith('/') || /^https?:\/\//u.test(src);
  if (!allowed) {
    errors.push(`${label}: 그림은 data URL이나 앱 안의 경로여야 해요.`);
    return null;
  }
  if (src.length > FINAL_IMAGE_MAX_BYTES) {
    errors.push(
      `${label}: 그림이 너무 커요(${formatBytes(src.length)}). 1280px 이하 WebP/JPG로 줄여 주세요.`,
    );
    return null;
  }
  return { src, alt: textOrNull(value.alt) ?? '문제 그림' };
}

function parseQuestion(
  raw: unknown,
  grade: Grade,
  index: number,
  errors: string[],
): FinalQuestionConfig | null {
  const label = `${grade}학년 ${index + 1}번 문제`;
  if (!isRecord(raw)) {
    errors.push(`${label}: 형식이 잘못됐어요.`);
    return null;
  }
  const before = errors.length;
  const text = textOrNull(raw.text);
  if (!text) errors.push(`${label}: 문제 글이 없어요.`);
  const area = parseArea(raw.area);
  if (!area) errors.push(`${label}: 영역은 생각·관찰·표현·명령·검증 중 하나여야 해요.`);
  const choices = Array.isArray(raw.choices) ? raw.choices.map(textOrNull) : [];
  if (choices.length !== 4 || choices.some((choice) => choice === null)) {
    errors.push(`${label}: 보기는 4개를 모두 적어야 해요.`);
  }
  const answer = parseChoiceNo(raw.answer);
  if (answer === null) errors.push(`${label}: 정답은 1~4 중 하나여야 해요.`);
  const hintRemove = parseChoiceNo(raw.hintRemove);
  if (hintRemove === null) errors.push(`${label}: 힌트로 지울 보기는 1~4 중 하나여야 해요.`);
  const image = parseImage(raw.image, label, errors);
  if (errors.length > before || !text || !area || answer === null || hintRemove === null) {
    return null;
  }
  return {
    question: {
      id: textOrNull(raw.id) ?? `q${index + 1}`,
      area,
      category: textOrNull(raw.category),
      text,
      passage: textOrNull(raw.passage),
      image,
      choices: choices.map((choice, choiceIndex) => ({
        id: CHOICE_IDS[choiceIndex],
        label: choice ?? '',
      })),
    },
    answerChoiceId: CHOICE_IDS[answer - 1],
    hintRemoveChoiceId: CHOICE_IDS[hintRemove - 1],
    explanation: textOrNull(raw.explanation),
  };
}

/** JSON 파일 내용을 학년별 문제 묶음으로 바꾼다. 문제가 있으면 모두 모아 errors로 돌려준다. */
export function parseFinalQuestionUpload(
  raw: unknown,
  questionCount: number = FINAL_QUESTION_COUNT,
): FinalQuestionUploadResult {
  const errors: string[] = [];
  if (!isRecord(raw) || raw.format !== FINAL_UPLOAD_FORMAT) {
    return {
      sets: [],
      errors: [
        '최종 미션 문제 파일이 아니에요. npm run final:build로 만든 JSON 파일을 골라 주세요.',
      ],
    };
  }
  if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
    return { sets: [], errors: ['파일에 학년별 문제가 없어요.'] };
  }
  const sets: FinalQuestionSet[] = [];
  const seen = new Set<Grade>();
  for (const rawSet of raw.sets) {
    if (!isRecord(rawSet) || !(FINAL_GRADES as readonly unknown[]).includes(rawSet.grade)) {
      errors.push('학년은 3, 4, 5, 6 중 하나여야 해요.');
      continue;
    }
    const grade = rawSet.grade as Grade;
    if (seen.has(grade)) {
      errors.push(`${grade}학년 문제가 두 번 들어 있어요.`);
      continue;
    }
    seen.add(grade);
    const rawQuestions = Array.isArray(rawSet.questions) ? rawSet.questions : [];
    const questions = rawQuestions.map((item, index) => parseQuestion(item, grade, index, errors));
    if (questions.some((question) => question === null)) continue;
    const set: FinalQuestionSet = {
      grade,
      questions: questions as FinalQuestionConfig[],
      source: 'upload',
      updatedAt: null,
    };
    const error = getQuestionSetError(set, questionCount);
    if (error) {
      errors.push(`${grade}학년: ${error}`);
      continue;
    }
    const { bytes } = summarizeFinalQuestionSet(set);
    if (bytes > FINAL_SET_MAX_BYTES) {
      errors.push(
        `${grade}학년: 문제와 그림을 합친 크기(${formatBytes(bytes)})가 너무 커요. 그림을 줄여 주세요.`,
      );
      continue;
    }
    sets.push(set);
  }
  return { sets: errors.length > 0 ? [] : sets, errors };
}

export function summarizeFinalQuestionSet(set: FinalQuestionSet): FinalQuestionSetStats {
  return {
    grade: set.grade,
    questionCount: set.questions.length,
    imageCount: set.questions.filter((config) => config.question.image !== null).length,
    bytes: new TextEncoder().encode(JSON.stringify(set.questions)).length,
  };
}

/** 최종 미션을 열었거나 시작한 반이 있으면 문제를 바꿀 수 없다(답안이 문제 번호에 묶여 있다). */
export function getQuestionReplaceBlocker(
  session: Pick<FinalSession, 'grade' | 'status'>,
  states: readonly Pick<FinalClassState, 'startedAt'>[],
): string | null {
  if (session.status !== 'locked') {
    return `${session.grade}학년 최종 미션이 이미 열려 있어 문제를 바꿀 수 없어요.`;
  }
  if (states.some((state) => state.startedAt !== null)) {
    return `${session.grade}학년에 이미 시작한 반이 있어 문제를 바꿀 수 없어요.`;
  }
  return null;
}
