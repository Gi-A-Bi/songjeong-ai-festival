#!/usr/bin/env node
/*
 * 도서관 오류찾기 원고(content/작성/05-도서관-오류찾기.md)를 교사 화면의 "문제 파일 올리기"에서
 * 고르는 JSON 파일(content/작성/도서관-업로드.json)로 바꾼다.
 *
 *   npm run library:build
 *
 * - "작성 완료" 표시가 있어야 만든다.
 * - 학년은 "## 3학년", "## 공통" 같은 제목으로 나누고, 그 아래 "### 질문 1 · 주제 · "AI에게 한 질문""
 *   제목마다 문제 하나를 적는다. "- 글 제목:", "- 문장(한 줄에 한 문장):" + 번호 목록,
 *   "- 틀린 문장: ③", "- 바르게 고친 내용으로 인정하는 말: a, b"를 읽는다.
 *   서술형은 "- 글 본문:"과 "- 틀린 부분으로 인정하는 말:"을 쓴다.
 * - "- 하나만 고르기: 아니요"라고 적지 않으면 학생이 질문 하나만 골라 푸는 방식으로 만든다.
 * - 정답이 들어 있으므로 만들어진 JSON은 content/작성/ 밖으로 옮기지 않는다.
 * - 외부 패키지 없이 Node만으로 돈다.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = resolve(ROOT, 'content', '작성');
const SOURCE = resolve(CONTENT_DIR, '05-도서관-오류찾기.md');
const OUTPUT = resolve(CONTENT_DIR, '도서관-업로드.json');
const GRADES = [3, 4, 5, 6];
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
}

function setLabel(grades) {
  return grades.length === 0 ? '공통' : `${grades.join('·')}학년`;
}

/** "## 3학년" → [3], "## 공통" → [], 학년 제목이 아니면 null */
function parseGradeHeading(title) {
  const trimmed = title.trim();
  if (/^(학년\s*)?공통/u.test(trimmed)) return [];
  if (!/학년/u.test(trimmed)) return null;
  const grades = [...trimmed.replace(/학년.*$/u, '').matchAll(/\d/gu)]
    .map((match) => Number(match[0]))
    .filter((grade) => GRADES.includes(grade));
  return grades.length > 0 ? [...new Set(grades)].sort((a, b) => a - b) : null;
}

/** 따옴표와 백틱을 벗긴다. */
function unquote(value) {
  return value
    .trim()
    .replace(/^[`"“”'‘’「」]+/u, '')
    .replace(/[`"“”'‘’「」]+$/u, '')
    .trim();
}

function splitList(value) {
  return unquote(value)
    .split(/[,，、]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** "③ (설명)" / "3" / "3번" → 1부터 세는 번호 */
function wrongNo(value, count) {
  const trimmed = value.trim();
  const circled = CIRCLED.indexOf(trimmed.charAt(0));
  const no = circled >= 0 ? circled + 1 : Number(trimmed.replace(/\s.*$/u, '').replace(/번$/u, ''));
  return Number.isInteger(no) && no >= 1 && no <= count ? no : null;
}

function keyValue(line) {
  const match = line.match(/^-\s*([^:：]+?)\s*[:：]\s*(.*)$/u);
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

/** 원고를 학년 묶음과 질문 블록으로 나눈다. 학년 제목 밖의 글과 "## 사이트에 등록" 아래는 읽지 않는다. */
function splitSets(markdown) {
  const sets = [];
  let currentSet = null;
  let currentBlock = null;
  let pickOne = true;
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const pick = line.match(/^-\s*하나만\s*고르기\s*[:：]\s*(.+)$/u);
    if (pick) {
      pickOne = !/아니|no|false|끔/iu.test(pick[1]);
      continue;
    }
    const section = line.match(/^##\s+(.+)$/u);
    if (section) {
      currentBlock = null;
      const grades = parseGradeHeading(section[1]);
      currentSet = grades ? { grades, blocks: [] } : null;
      if (currentSet) sets.push(currentSet);
      continue;
    }
    const heading = line.match(/^###\s*질문\s*(\d+)\s*(.*)$/u);
    if (heading) {
      currentBlock = currentSet ? { no: Number(heading[1]), head: heading[2], lines: [] } : null;
      if (currentBlock) currentSet.blocks.push(currentBlock);
      continue;
    }
    if (/^#{1,3}\s/u.test(line)) {
      currentBlock = null;
      continue;
    }
    if (currentBlock) currentBlock.lines.push(line);
  }
  return { sets, pickOne };
}

/** "· 과학 · "고래에 대해 알려 줘"" → { subject, prompt } */
function parseHead(head) {
  const parts = head
    .split(/[·•]/u)
    .map((part) => unquote(part))
    .filter((part) => part.length > 0);
  if (parts.length >= 2) return { subject: parts[0], prompt: parts[1] };
  if (parts.length === 1) return { subject: '', prompt: parts[0] };
  return { subject: '', prompt: '' };
}

/** 블록 하나를 문제 하나로 읽는다. */
function parseBlock(block, label, problems) {
  const { subject, prompt } = parseHead(block.head);
  const fields = {
    title: '',
    passage: [],
    sentences: [],
    wrong: '',
    accept: [],
    wrongPartAccept: [],
  };
  let mode = null;
  for (const line of block.lines) {
    const entry = keyValue(line);
    if (entry) {
      mode = null;
      const { key, value } = entry;
      if (/^글 제목/u.test(key)) fields.title = unquote(value);
      else if (/^글 본문/u.test(key)) {
        mode = 'passage';
        if (value) fields.passage.push(unquote(value));
      } else if (/^문장/u.test(key)) mode = 'sentences';
      else if (/^틀린 문장/u.test(key)) fields.wrong = value;
      else if (/^바르게 고친 내용/u.test(key)) fields.accept = splitList(value);
      else if (/^틀린 부분/u.test(key)) fields.wrongPartAccept = splitList(value);
      continue;
    }
    if (mode === 'sentences') {
      const item = line.match(/^\s*\d+[.)]\s+(.+)$/u);
      if (item) fields.sentences.push(item[1].trim());
      else if (line.trim()) mode = null;
    } else if (mode === 'passage') {
      if (line.trim()) fields.passage.push(line.trim());
      else if (fields.passage.length > 0) mode = null;
    }
  }

  const before = problems.length;
  if (!fields.title) problems.push(`${label}: "- 글 제목:"이 없어요.`);
  if (fields.accept.length === 0) {
    problems.push(`${label}: "- 바르게 고친 내용으로 인정하는 말:"이 없어요.`);
  }
  if (fields.sentences.length === 0 && fields.passage.length > 0) {
    if (fields.wrongPartAccept.length === 0) {
      problems.push(`${label}: 서술형은 "- 틀린 부분으로 인정하는 말:"이 필요해요.`);
    }
    if (problems.length > before) return null;
    return {
      type: 'find',
      prompt,
      subject,
      title: fields.title,
      passage: fields.passage.join(' '),
      wrongPartAccept: fields.wrongPartAccept,
      accept: fields.accept,
    };
  }
  if (fields.sentences.length < 2) {
    problems.push(
      `${label}: "- 문장(한 줄에 한 문장):" 아래에 "1. …" 문장을 두 개 이상 적어 주세요.`,
    );
  }
  const wrong = wrongNo(fields.wrong, fields.sentences.length);
  if (wrong === null) {
    problems.push(
      `${label}: "- 틀린 문장:"에 ①~${CIRCLED[fields.sentences.length - 1] ?? '⑩'} 번호를 적어 주세요.`,
    );
  }
  if (problems.length > before) return null;
  return {
    type: 'choose',
    prompt,
    subject,
    title: fields.title,
    sentences: fields.sentences,
    wrong,
    accept: fields.accept,
  };
}

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`원고가 없어요: ${SOURCE}`);
    process.exitCode = 1;
    return;
  }
  const markdown = readFileSync(SOURCE, 'utf8');
  if (!/\[x\]\s*작성 완료/iu.test(markdown)) {
    console.error('원고의 "작성 상태"에서 "[x] 작성 완료"로 표시한 뒤 다시 실행해 주세요.');
    process.exitCode = 1;
    return;
  }

  const { sets: rawSets, pickOne } = splitSets(markdown);
  const problems = [];
  const sets = rawSets
    .filter((set) => set.blocks.length > 0)
    .map((set) => {
      const label = setLabel(set.grades);
      const questions = set.blocks
        .map((block) => parseBlock(block, `${label} 질문 ${block.no}`, problems))
        .filter(Boolean);
      console.log(
        `- ${label}: ${questions.length}문제 (${questions
          .map(
            (question) =>
              `${question.subject || '주제 없음'} · ${question.prompt || question.title}`,
          )
          .join(' / ')})`,
      );
      return { grades: set.grades, questions };
    });

  if (problems.length > 0) {
    console.error('\n고칠 곳:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (sets.length === 0) {
    console.error(
      '\n문제가 없어요. "## 3학년" 같은 학년 제목 아래에 "### 질문 1"부터 적어 주세요.',
    );
    process.exitCode = 1;
    return;
  }

  const output = {
    format: 'songjeong-library-questions',
    version: 1,
    createdAt: new Date().toISOString(),
    pickOne,
    sets,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `\n만든 파일: ${OUTPUT} (${formatBytes(statSync(OUTPUT).size)}) · 하나만 고르기: ${pickOne ? '켬' : '끔'}`,
  );
  console.log(
    '교사 화면 → AI 오류찾기 부스 → 문제와 정답 등록 → "문제 파일 올리기"에서 이 파일을 고르세요. 파일은 정답이 들어 있으니 다른 곳에 두지 마세요.',
  );
}

main();
