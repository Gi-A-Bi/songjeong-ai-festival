import {
  circledNumber,
  getLibraryCheckConfigError,
  hasLibraryCheckAnswerKey,
  LIBRARY_GRADES,
  normalizeLibraryCheckConfig,
} from './libraryCheck';
import type { Grade, LibraryCheckConfig, LibraryQuestion } from './types';

/*
 * 교사가 올리는 도서관 오류찾기 문제 파일(JSON)의 형식과 검사.
 * 파일은 scripts/build-library-upload.mjs가 content/작성/05-도서관-오류찾기.md에서 만든다.
 * 정답이 들어 있으므로 파일 자체는 공개 저장소에 두지 않는다.
 * 골든벨과 달리 파일의 내용으로 설정 전체(공통·학년별 문제, 하나만 고르기)를 바꾼다.
 */

export const LIBRARY_UPLOAD_FORMAT = 'songjeong-library-questions';
export const LIBRARY_UPLOAD_VERSION = 1;
/** 한 묶음(공통 또는 한 학년)에 넣을 수 있는 문제 수 */
export const LIBRARY_UPLOAD_MAX_QUESTIONS = 5;

export interface LibraryUploadSet {
  /** 비어 있으면 공통 문제 */
  grades: Grade[];
  questions: LibraryQuestion[];
}

export interface LibraryUploadResult {
  /** 올릴 설정. errors가 있으면 null */
  config: LibraryCheckConfig | null;
  /** 미리보기용 묶음. errors가 있으면 비어 있다. */
  sets: LibraryUploadSet[];
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function textList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[,，、\n]/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return Array.isArray(value) ? value.map(text).filter((item) => item.length > 0) : [];
}

export function getLibrarySetLabel(grades: readonly Grade[]): string {
  return grades.length === 0 ? '공통' : `${grades.join('·')}학년`;
}

function parseGrades(value: unknown): Grade[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const grades: Grade[] = [];
  for (const item of value) {
    const grade = LIBRARY_GRADES.find((candidate) => candidate === Number(item));
    if (grade === undefined) return null;
    if (!grades.includes(grade)) grades.push(grade);
  }
  return grades.sort((a, b) => a - b);
}

/** 틀린 문장 번호: ③, "3", 3, "3번" 모두 받고 0부터 세는 차례로 바꾼다. */
function parseWrongIndex(value: unknown, count: number): number | null {
  const raw = text(value);
  const circled = '①②③④⑤⑥⑦⑧⑨⑩'.indexOf(raw.charAt(0));
  const no = circled >= 0 ? circled + 1 : Number(raw.replace(/번$/u, ''));
  return Number.isInteger(no) && no >= 1 && no <= count ? no - 1 : null;
}

function parseQuestion(
  raw: unknown,
  label: string,
  id: string,
  errors: string[],
): LibraryQuestion | null {
  if (!isRecord(raw)) {
    errors.push(`${label}: 형식이 잘못됐어요.`);
    return null;
  }
  const before = errors.length;
  const type = text(raw.type) === 'find' ? 'find' : 'choose';
  const title = text(raw.title);
  if (!title) errors.push(`${label}: 글 제목이 없어요.`);
  const prompt = text(raw.prompt);
  const subject = text(raw.subject);
  const correctionKeywords = textList(raw.accept ?? raw.correctionKeywords);
  if (correctionKeywords.length === 0) {
    errors.push(`${label}: 바르게 고친 내용으로 인정하는 말이 없어요.`);
  }

  if (type === 'find') {
    const passage = text(raw.passage);
    if (!passage) errors.push(`${label}: 글 본문이 없어요.`);
    const wrongPartKeywords = textList(raw.wrongPartAccept ?? raw.wrongPartKeywords);
    if (wrongPartKeywords.length === 0) {
      errors.push(`${label}: 틀린 부분으로 인정하는 말이 없어요.`);
    }
    if (errors.length > before) return null;
    return {
      id,
      type: 'find',
      title,
      ...(prompt ? { prompt } : {}),
      ...(subject ? { subject } : {}),
      passage,
      answerKey: { wrongPartKeywords, correctionKeywords },
    };
  }

  const sentences = textList(raw.sentences);
  if (sentences.length < 2) errors.push(`${label}: 문장은 두 개 이상이어야 해요.`);
  const wrongIndex =
    raw.wrongIndex !== undefined && raw.wrongIndex !== null
      ? Number.isInteger(raw.wrongIndex) &&
        Number(raw.wrongIndex) >= 0 &&
        Number(raw.wrongIndex) < sentences.length
        ? Number(raw.wrongIndex)
        : null
      : parseWrongIndex(raw.wrong, sentences.length);
  if (wrongIndex === null) {
    errors.push(`${label}: 틀린 문장 번호는 1~${sentences.length} 중 하나여야 해요.`);
  }
  if (errors.length > before) return null;
  return {
    id,
    type: 'choose',
    title,
    ...(prompt ? { prompt } : {}),
    ...(subject ? { subject } : {}),
    sentences,
    answerKey: { wrongIndex: wrongIndex ?? 0, correctionKeywords },
  };
}

/** 미리보기 한 줄: [주제] 질문 → 글 제목 (문장 5개, 틀린 문장 ③) */
export function describeLibraryUploadQuestion(question: LibraryQuestion): string {
  const head = [question.subject ? `[${question.subject}]` : '', question.prompt ?? question.title]
    .filter(Boolean)
    .join(' ');
  if (question.type === 'find') return `${head} → ${question.title} (서술형)`;
  const wrong = question.answerKey ? circledNumber(question.answerKey.wrongIndex) : '?';
  return `${head} → ${question.title} (문장 ${question.sentences.length}개, 틀린 문장 ${wrong})`;
}

/** 올린 파일을 읽어 설정으로 바꾼다. 고칠 곳이 하나라도 있으면 아무것도 넣지 않는다. */
export function parseLibraryUpload(raw: unknown): LibraryUploadResult {
  if (!isRecord(raw) || raw.format !== LIBRARY_UPLOAD_FORMAT) {
    return {
      config: null,
      sets: [],
      errors: [
        '도서관 오류찾기 문제 파일이 아니에요. npm run library:build로 만든 파일을 골라 주세요.',
      ],
    };
  }
  if (raw.version !== LIBRARY_UPLOAD_VERSION) {
    return {
      config: null,
      sets: [],
      errors: ['파일 형식 버전이 달라요. npm run library:build로 다시 만들어 주세요.'],
    };
  }
  if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
    return { config: null, sets: [], errors: ['파일에 문제 묶음이 없어요.'] };
  }

  const errors: string[] = [];
  const sets: LibraryUploadSet[] = [];
  const taken = new Set<string>();
  raw.sets.forEach((rawSet, setIndex) => {
    const grades = isRecord(rawSet) ? parseGrades(rawSet.grades) : null;
    if (!isRecord(rawSet) || grades === null) {
      errors.push(`${setIndex + 1}번째 묶음: 학년은 3~6 중에서 적어야 해요.`);
      return;
    }
    const label = getLibrarySetLabel(grades);
    for (const key of grades.length === 0 ? ['공통'] : grades.map(String)) {
      if (taken.has(key)) errors.push(`${label}: 같은 학년의 문제 묶음이 두 번 들어 있어요.`);
      taken.add(key);
    }
    const rawQuestions = Array.isArray(rawSet.questions) ? rawSet.questions : [];
    if (rawQuestions.length === 0) {
      errors.push(`${label}: 문제가 없어요.`);
      return;
    }
    if (rawQuestions.length > LIBRARY_UPLOAD_MAX_QUESTIONS) {
      errors.push(`${label}: 문제는 ${LIBRARY_UPLOAD_MAX_QUESTIONS}개까지 넣을 수 있어요.`);
      return;
    }
    // 다시 올려도 학생 답이 같은 문제를 따라가도록 묶음과 순서로 ID를 정한다(등록 화면과 같은 규칙).
    const prefix = grades.length === 0 ? 'q' : `g${grades.join('')}q`;
    const questions = rawQuestions
      .map((rawQuestion, index) =>
        parseQuestion(rawQuestion, `${label} ${index + 1}번 문제`, `${prefix}${index + 1}`, errors),
      )
      .filter((question): question is LibraryQuestion => question !== null);
    sets.push({ grades, questions });
  });
  if (errors.length > 0) return { config: null, sets: [], errors };

  const config: LibraryCheckConfig = { type: 'library_check', questions: [] };
  const gradeQuestions: Partial<Record<Grade, LibraryQuestion[]>> = {};
  for (const set of sets) {
    if (set.grades.length === 0) {
      config.questions = set.questions;
      continue;
    }
    for (const grade of set.grades) {
      // 여러 학년이 한 묶음을 같이 쓰면 학년마다 같은 문제를 둔다.
      gradeQuestions[grade] = set.questions.map((question) => ({
        ...question,
        id: question.id.replace(/^g\d+q/u, `g${grade}q`),
      }));
    }
  }
  if (Object.keys(gradeQuestions).length > 0) config.gradeQuestions = gradeQuestions;
  if (raw.pickOne === true) config.pickOne = true;

  const normalized = normalizeLibraryCheckConfig(config);
  const configError = getLibraryCheckConfigError(normalized);
  if (configError) return { config: null, sets: [], errors: [configError] };
  if (!hasLibraryCheckAnswerKey(normalized)) {
    return { config: null, sets: [], errors: ['모든 문제에 정답이 있어야 올릴 수 있어요.'] };
  }
  return { config: normalized, sets, errors: [] };
}
