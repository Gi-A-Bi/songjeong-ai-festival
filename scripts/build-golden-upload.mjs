#!/usr/bin/env node
/*
 * 골든벨 원고(content/작성/01-골든벨.md)를 교사 화면의 "문제 파일 올리기"에서
 * 고르는 JSON 파일(content/작성/골든벨-업로드.json)로 바꾼다.
 *
 *   npm run golden:build
 *
 * - "작성 완료" 표시가 있어야 만든다.
 * - 학년은 "## 3학년", "## 5·6학년", "## 공통" 같은 제목으로 나눈다.
 * - 정답이 들어 있으므로 만들어진 JSON은 content/작성/ 밖으로 옮기지 않는다.
 * - 외부 패키지 없이 Node만으로 돈다.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = resolve(ROOT, 'content', '작성');
const SOURCE = resolve(CONTENT_DIR, '01-골든벨.md');
const OUTPUT = resolve(CONTENT_DIR, '골든벨-업로드.json');
const GRADES = [3, 4, 5, 6];
/** src/domain/goldenBellUpload.ts와 같은 한도 */
const MAX_QUESTIONS = 30;
const MAX_CHOICES = 4;

const KIND_BY_LABEL = {
  ox: 'ox',
  'o/x': 'ox',
  객관식: 'choice',
  choice: 'choice',
  단답형: 'short',
  주관식: 'short',
  short: 'short',
};
const KIND_LABELS = { ox: 'O/X', choice: '객관식', short: '단답형' };
const LEVEL_BY_LABEL = { 하: 'low', 중: 'mid', 상: 'high', low: 'low', mid: 'mid', high: 'high' };
const CIRCLED = '①②③④';

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
}

function setLabel(grades) {
  return grades.length === 0 ? '공통' : `${grades.join('·')}학년`;
}

/** "## 5·6학년" → [5, 6], "## 공통" → [], 학년 제목이 아니면 null */
function parseGradeHeading(title) {
  const trimmed = title.trim();
  if (/^(학년\s*)?공통/u.test(trimmed)) return [];
  if (!/학년/u.test(trimmed)) return null;
  const grades = [...trimmed.replace(/학년.*$/u, '').matchAll(/\d/gu)]
    .map((match) => Number(match[0]))
    .filter((grade) => GRADES.includes(grade));
  return grades.length > 0 ? [...new Set(grades)].sort((a, b) => a - b) : null;
}

/** 원고를 학년 묶음과 문제 블록으로 나눈다. 학년 제목 밖의 문제와 "## 참고" 아래는 읽지 않는다. */
function splitSets(markdown) {
  const sets = [];
  let currentSet = null;
  let currentBlock = null;
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const section = line.match(/^##\s+(.+)$/u);
    if (section) {
      currentBlock = null;
      const grades = parseGradeHeading(section[1]);
      currentSet = grades ? { grades, blocks: [] } : null;
      if (currentSet) sets.push(currentSet);
      continue;
    }
    const heading = line.match(/^###\s*문제\s*(\d+)/u);
    if (heading) {
      currentBlock = currentSet ? { no: Number(heading[1]), lines: [] } : null;
      if (currentBlock) currentSet.blocks.push(currentBlock);
      continue;
    }
    if (/^#{1,3}\s/u.test(line)) {
      currentBlock = null;
      continue;
    }
    if (currentBlock) currentBlock.lines.push(line);
  }
  return sets;
}

function keyValue(line) {
  const match = line.match(/^-\s*([^:：]+?)\s*[:：]\s*(.*)$/u);
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

function splitList(value) {
  return value
    .split(/[,，、]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function choiceNo(value, count) {
  const trimmed = value.trim();
  const circled = CIRCLED.indexOf(trimmed);
  const no = circled >= 0 ? circled + 1 : Number(trimmed.replace(/번$/u, ''));
  return Number.isInteger(no) && no >= 1 && no <= count ? no : null;
}

/** 블록 하나를 문제 하나로 읽는다. */
function parseBlock(block, label, prefix, index, problems) {
  const fields = {
    kind: '',
    level: '',
    area: '',
    question: '',
    choices: ['', '', '', ''],
    answer: '',
    accept: '',
    hint: '',
    explanation: '',
  };
  for (const line of block.lines) {
    const pair = keyValue(line.trim());
    if (!pair) continue;
    const { key, value } = pair;
    if (key.startsWith('형식') || key.startsWith('유형')) fields.kind = value;
    else if (key.startsWith('난이도')) fields.level = value;
    else if (key.startsWith('영역')) fields.area = value;
    else if (key.startsWith('문제')) fields.question = value;
    else if (/^보기\s*[1-4]$/u.test(key))
      fields.choices[Number(key.replace(/\D/gu, '')) - 1] = value;
    else if (key.startsWith('함께 인정') || key.startsWith('인정')) fields.accept = value;
    else if (key.startsWith('정답')) fields.answer = value;
    else if (key.startsWith('힌트')) fields.hint = value;
    else if (key.startsWith('해설')) fields.explanation = value;
  }

  const name = `${label} ${index + 1}번`;
  const kind = KIND_BY_LABEL[fields.kind.toLowerCase().replace(/\s/gu, '')];
  if (!kind) {
    problems.push(
      `${name}: 형식을 OX, 객관식, 단답형 중에서 적어 주세요. (지금: "${fields.kind}")`,
    );
    return null;
  }
  if (!fields.question) problems.push(`${name}: 문제 글이 없어요.`);
  const level = fields.level ? LEVEL_BY_LABEL[fields.level.toLowerCase()] : null;
  if (fields.level && !level) problems.push(`${name}: 난이도는 하·중·상 중 하나여야 해요.`);

  const question = {
    id: `${prefix}-q${index + 1}`,
    no: index + 1,
    kind,
    level: level ?? null,
    area: fields.area || null,
    question: fields.question,
    explanation: fields.explanation || null,
  };

  if (kind === 'ox') {
    const answer = fields.answer.toUpperCase();
    if (answer !== 'O' && answer !== 'X') problems.push(`${name}: 정답은 O나 X여야 해요.`);
    return { ...question, answer };
  }
  if (kind === 'choice') {
    const filled = fields.choices.filter((choice) => choice);
    const lastFilled = fields.choices.reduce((last, choice, at) => (choice ? at : last), -1);
    if (filled.length < 2) problems.push(`${name}: 보기를 2개 이상 적어 주세요.`);
    else if (filled.length !== lastFilled + 1) {
      problems.push(`${name}: 보기는 1번부터 빈칸 없이 차례로 적어 주세요.`);
    }
    const answer = choiceNo(fields.answer, Math.min(filled.length, MAX_CHOICES));
    if (answer === null) problems.push(`${name}: 정답은 보기 번호(1~${filled.length})여야 해요.`);
    return { ...question, choices: filled, answer };
  }
  if (!fields.answer) problems.push(`${name}: 정답이 없어요.`);
  return {
    ...question,
    hint: fields.hint || null,
    answer: fields.answer,
    accept: splitList(fields.accept),
  };
}

function main() {
  console.log(`원고: ${SOURCE}`);
  if (!existsSync(SOURCE)) {
    console.error('\n원고 파일이 없어요. content/양식/01-골든벨.md를 복사해 적어 주세요.');
    process.exitCode = 1;
    return;
  }
  const markdown = readFileSync(SOURCE, 'utf8');
  if (!/\[[xX]\]\s*작성 완료/u.test(markdown)) {
    console.error('\n"[x] 작성 완료" 표시가 없어요. 다 적은 뒤 맨 위의 작성 상태를 바꿔 주세요.');
    process.exitCode = 1;
    return;
  }

  const problems = [];
  const taken = new Set();
  const sets = splitSets(markdown)
    .filter((set) => set.blocks.length > 0)
    .map((set) => {
      const label = setLabel(set.grades);
      for (const key of set.grades.length === 0 ? ['공통'] : set.grades.map(String)) {
        if (taken.has(key)) problems.push(`${label}: 같은 학년의 제목이 두 번 있어요.`);
        taken.add(key);
      }
      if (set.blocks.length > MAX_QUESTIONS) {
        problems.push(`${label}: 문제는 ${MAX_QUESTIONS}개까지 넣을 수 있어요.`);
      }
      const prefix = set.grades.length === 0 ? 'common' : `g${set.grades.join('')}`;
      const questions = set.blocks
        .map((block, index) => {
          if (block.no !== index + 1) {
            console.warn(
              `  [주의] ${label}: 문제 번호 ${block.no}이(가) 순서(${index + 1})와 달라요. 순서대로 씁니다.`,
            );
          }
          return parseBlock(block, label, prefix, index, problems);
        })
        .filter(Boolean);
      const counts = { ox: 0, choice: 0, short: 0 };
      for (const question of questions) counts[question.kind] += 1;
      console.log(
        `- ${label}: ${questions.length}문항 (${Object.entries(counts)
          .map(([kind, count]) => `${KIND_LABELS[kind]} ${count}`)
          .join(', ')})`,
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
      '\n문제가 없어요. "## 3학년" 같은 학년 제목 아래에 "### 문제 1"부터 적어 주세요.',
    );
    process.exitCode = 1;
    return;
  }

  const output = {
    format: 'songjeong-golden-bell-questions',
    version: 1,
    createdAt: new Date().toISOString(),
    sets,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n만든 파일: ${OUTPUT} (${formatBytes(statSync(OUTPUT).size)})`);
  console.log(
    '교사 화면 → AI 골든벨 부스 → 문제 등록 → "문제 파일 올리기"에서 이 파일을 고르세요. 파일은 정답이 들어 있으니 다른 곳에 두지 마세요.',
  );
}

main();
