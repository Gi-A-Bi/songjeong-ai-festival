#!/usr/bin/env node
/*
 * 학년별 최종 미션 원고(content/작성/06-최종미션-N학년.md)를 총괄 설정 화면에서
 * 올리는 JSON 파일(content/작성/최종미션-업로드.json)로 바꾼다.
 *
 *   npm run final:build
 *
 * - "작성 완료" 표시가 있는 파일만 읽는다.
 * - 원고의 그림은 파일째 읽어 data URL로 넣는다(앱 저장소에 그림 파일을 두지 않는다).
 * - 정답이 들어 있으므로 만들어진 JSON은 content/작성/ 밖으로 옮기지 않는다.
 * - 외부 패키지 없이 Node만으로 돈다. 그림은 미리 1280px 이하 WebP/JPG로 줄여 둔다.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = resolve(ROOT, 'content', '작성');
const OUTPUT = resolve(CONTENT_DIR, '최종미션-업로드.json');
const GRADES = [3, 4, 5, 6];
const QUESTION_COUNT = 10;
/** src/domain/finalQuestionUpload.ts와 같은 한도 */
const IMAGE_MAX_BYTES = 400_000;
const SET_MAX_BYTES = 800_000;

const AREA_BY_LABEL = {
  생각: 'thinking',
  관찰: 'observation',
  표현: 'expression',
  명령: 'command',
  검증: 'verification',
};
const MIME_BY_EXT = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const CIRCLED = '①②③④';

function choiceNo(value) {
  const trimmed = value.trim();
  const circled = CIRCLED.indexOf(trimmed);
  if (circled >= 0) return circled + 1;
  const parsed = Number(trimmed.replace(/번$/u, ''));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : null;
}

function parseArea(value) {
  const trimmed = value.trim().replace(/\s*(영역|카드)$/u, '');
  if (Object.values(AREA_BY_LABEL).includes(trimmed)) return trimmed;
  return AREA_BY_LABEL[trimmed] ?? null;
}

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
}

/** 원고 한 파일을 문제 블록 목록으로 나눈다. "## 참고" 아래의 샘플은 읽지 않는다. */
function splitBlocks(markdown) {
  const blocks = [];
  let current = null;
  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{2,3}\s*문제\s*(\d+)\s*(.*)$/u);
    if (heading) {
      current = { no: Number(heading[1]), title: heading[2].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    if (/^#{1,3}\s*참고/u.test(line)) {
      current = null;
      continue;
    }
    if (/^#{1,3}\s/u.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  return blocks;
}

function keyValue(line) {
  const match = line.match(/^-\s*([^:：]+?)\s*[:：]\s*(.*)$/u);
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

/** 블록 하나를 문제 하나로 읽는다. 두 가지 원고 형식(양식·완성본)을 모두 받는다. */
function parseBlock(block, grade, index, mdDir, problems) {
  const label = `${grade}학년 ${index + 1}번`;
  const question = {
    id: `q${index + 1}`,
    no: index + 1,
    area: null,
    category: null,
    text: null,
    passage: null,
    image: null,
    choices: [null, null, null, null],
    answer: null,
    hintRemove: null,
    explanation: null,
  };
  const notes = [];
  const passageLines = [];

  // 제목: "문제 1. 넌센스" → 유형, "문제 1 (생각 영역)" → 영역
  const areaInTitle = block.title.match(/\(\s*(.+?)\s*\)/u);
  if (areaInTitle) question.area = parseArea(areaInTitle[1]);
  const categoryInTitle = block.title
    .replace(/\(.*?\)/u, '')
    .replace(/^[.．·:：\s]+/u, '')
    .trim();
  if (categoryInTitle) question.category = categoryInTitle;

  for (const line of block.lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bold = trimmed.match(/^\*\*(.+)\*\*$/u);
    if (bold) {
      question.text = bold[1].trim();
      continue;
    }
    if (trimmed.startsWith('>')) {
      passageLines.push(trimmed.replace(/^>\s?/u, '').trim());
      continue;
    }
    const image = trimmed.match(/^!\[(.*?)\]\((.+?)\)$/u);
    if (image) {
      question.image = { path: image[2].trim(), alt: image[1].trim() };
      continue;
    }
    const circled = trimmed.match(/^([①②③④])\s*(.+)$/u);
    if (circled) {
      question.choices[CIRCLED.indexOf(circled[1])] = circled[2].trim();
      continue;
    }
    const pair = keyValue(trimmed);
    if (!pair) continue;
    const { key, value } = pair;
    if (key.startsWith('문제')) question.text = value || question.text;
    else if (key.startsWith('제시문')) {
      if (value) passageLines.push(value);
    } else if (/^보기\s*[1-4]$/u.test(key)) {
      question.choices[Number(key.replace(/\D/gu, '')) - 1] = value || null;
    } else if (key.startsWith('정답')) question.answer = value ? choiceNo(value) : null;
    else if (key.startsWith('힌트')) question.hintRemove = value ? choiceNo(value) : null;
    else if (key.startsWith('해설')) question.explanation = value || null;
    else if (key.startsWith('영역')) question.area = value ? parseArea(value) : null;
    else if (key.startsWith('유형')) question.category = value || null;
    else if (key.startsWith('그림 설명') || key.startsWith('대체 텍스트')) {
      if (question.image) question.image.alt = value;
      else question.image = { path: null, alt: value };
    } else if (key.startsWith('그림')) {
      if (value) question.image = { path: value, alt: question.image?.alt ?? '' };
    } else if (key.includes('주의') || key.startsWith('메모')) {
      if (value) notes.push(value);
    }
  }
  if (passageLines.length > 0) question.passage = passageLines.join(' ');

  if (!question.text) problems.push(`${label}: 문제 글이 없어요.`);
  if (!question.area) problems.push(`${label}: 영역(생각·관찰·표현·명령·검증)을 적어 주세요.`);
  if (question.choices.some((choice) => !choice))
    problems.push(`${label}: 보기 4개를 모두 적어 주세요.`);
  if (question.answer === null) problems.push(`${label}: 정답 번호가 없어요.`);
  if (question.hintRemove === null) problems.push(`${label}: 힌트로 지울 보기 번호가 없어요.`);
  if (question.answer !== null && question.answer === question.hintRemove) {
    problems.push(`${label}: 힌트는 정답 보기를 지우면 안 돼요.`);
  }
  if (question.image) {
    if (!question.image.path) {
      problems.push(`${label}: 그림 파일 경로가 없어요.`);
      question.image = null;
    } else {
      question.image = loadImage(question.image, mdDir, label, problems);
    }
  }
  for (const note of notes) console.warn(`  [주의] ${label}: ${note}`);
  return question;
}

/** 그림 파일을 data URL로 바꾼다. 너무 크면 원고 쪽에서 줄이라고 알려 준다. */
function loadImage(image, mdDir, label, problems) {
  const path = resolve(mdDir, image.path);
  if (!existsSync(path)) {
    problems.push(`${label}: 그림 파일이 없어요 (${image.path}).`);
    return null;
  }
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) {
    problems.push(`${label}: 그림은 webp·png·jpg·gif·svg만 넣을 수 있어요 (${image.path}).`);
    return null;
  }
  const bytes = readFileSync(path);
  const src = `data:${mime};base64,${bytes.toString('base64')}`;
  if (src.length > IMAGE_MAX_BYTES) {
    problems.push(
      `${label}: 그림이 너무 커요(${formatBytes(statSync(path).size)}). 1280px 이하 WebP/JPG로 줄여 주세요 (${image.path}).`,
    );
    return null;
  }
  return { src, alt: image.alt || '문제 그림' };
}

function buildSet(grade, problems) {
  const file = resolve(CONTENT_DIR, `06-최종미션-${grade}학년.md`);
  if (!existsSync(file)) {
    console.log(`- ${grade}학년: 원고 파일이 없어 건너뜁니다.`);
    return null;
  }
  const markdown = readFileSync(file, 'utf8');
  if (!/\[[xX]\]\s*작성 완료/u.test(markdown)) {
    console.log(`- ${grade}학년: "[x] 작성 완료" 표시가 없어 건너뜁니다.`);
    return null;
  }
  const blocks = splitBlocks(markdown);
  const before = problems.length;
  if (blocks.length !== QUESTION_COUNT) {
    problems.push(`${grade}학년: 문제는 ${QUESTION_COUNT}개여야 해요. (지금 ${blocks.length}개)`);
  }
  const questions = blocks.map((block, index) => {
    if (block.no !== index + 1) {
      console.warn(
        `  [주의] ${grade}학년: 문제 번호 ${block.no}이(가) 순서(${index + 1})와 달라요. 순서대로 씁니다.`,
      );
    }
    return parseBlock(block, grade, index, dirname(file), problems);
  });
  const set = {
    grade,
    questions: questions.map((question) => ({
      id: question.id,
      no: question.no,
      area: question.area,
      category: question.category,
      text: question.text,
      passage: question.passage,
      image: question.image,
      choices: question.choices,
      answer: question.answer,
      hintRemove: question.hintRemove,
      explanation: question.explanation,
    })),
  };
  const bytes = Buffer.byteLength(JSON.stringify(set.questions), 'utf8');
  if (bytes > SET_MAX_BYTES) {
    problems.push(
      `${grade}학년: 문제와 그림을 합친 크기(${formatBytes(bytes)})가 너무 커요. 그림을 줄여 주세요.`,
    );
  }
  const images = questions.filter((question) => question.image).length;
  const status = problems.length > before ? '고칠 곳 있음' : '준비됨';
  console.log(
    `- ${grade}학년: 문제 ${questions.length}개, 그림 ${images}개, ${formatBytes(bytes)} → ${status}`,
  );
  return set;
}

function main() {
  console.log(`원고 폴더: ${CONTENT_DIR}`);
  const problems = [];
  const sets = GRADES.map((grade) => buildSet(grade, problems)).filter(Boolean);
  if (problems.length > 0) {
    console.error('\n고칠 곳:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (sets.length === 0) {
    console.error('\n올릴 학년이 없어요. 원고 맨 위의 "[x] 작성 완료"를 확인해 주세요.');
    process.exitCode = 1;
    return;
  }
  const output = {
    format: 'songjeong-final-questions',
    version: 1,
    createdAt: new Date().toISOString(),
    sets,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n만든 파일: ${OUTPUT} (${formatBytes(statSync(OUTPUT).size)})`);
  console.log(
    '총괄 설정 화면 → "최종 미션 문제 올리기"에서 이 파일을 고르세요. 파일은 정답이 들어 있으니 다른 곳에 두지 마세요.',
  );
}

main();
