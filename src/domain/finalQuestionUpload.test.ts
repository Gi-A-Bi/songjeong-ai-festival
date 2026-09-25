import { describe, expect, it } from 'vitest';
import { emptyFinalSession } from './finalMission';
import {
  FINAL_UPLOAD_FORMAT,
  getQuestionReplaceBlocker,
  parseFinalQuestionUpload,
  summarizeFinalQuestionSet,
} from './finalQuestionUpload';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

function question(no: number, extra: Record<string, unknown> = {}) {
  return {
    area: 'thinking',
    category: `유형 ${no}`,
    text: `${no}번 문제`,
    passage: null,
    image: null,
    choices: ['가', '나', '다', '라'],
    answer: 2,
    hintRemove: 4,
    explanation: `${no}번 해설`,
    ...extra,
  };
}

function file(questions: unknown[] = Array.from({ length: 10 }, (_, i) => question(i + 1))) {
  return { format: FINAL_UPLOAD_FORMAT, version: 1, sets: [{ grade: 4, questions }] };
}

describe('최종 미션 문제 파일 읽기', () => {
  it('정답·힌트 번호를 보기 ID로 바꾸고 유형·그림·해설을 함께 넣는다', () => {
    const questions = Array.from({ length: 10 }, (_, i) => question(i + 1));
    questions[2] = question(3, { image: { src: IMAGE, alt: '도형 그림' }, area: '관찰' });
    const { sets, errors } = parseFinalQuestionUpload(file(questions));
    expect(errors).toEqual([]);
    expect(sets).toHaveLength(1);
    const set = sets[0];
    expect(set).toMatchObject({ grade: 4, source: 'upload', updatedAt: null });
    expect(set.questions[0]).toMatchObject({
      question: { id: 'q1', category: '유형 1', text: '1번 문제', image: null },
      answerChoiceId: 'b',
      hintRemoveChoiceId: 'd',
      explanation: '1번 해설',
    });
    expect(set.questions[0].question.choices.map((choice) => choice.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(set.questions[2].question).toMatchObject({
      area: 'observation',
      image: { src: IMAGE, alt: '도형 그림' },
    });
    expect(summarizeFinalQuestionSet(set)).toMatchObject({
      grade: 4,
      questionCount: 10,
      imageCount: 1,
    });
  });

  it('다른 파일이나 학년이 겹치는 파일은 거부한다', () => {
    expect(parseFinalQuestionUpload({ hello: 1 }).errors[0]).toMatch(/문제 파일이 아니에요/);
    expect(parseFinalQuestionUpload({ format: FINAL_UPLOAD_FORMAT, sets: [] }).errors).toEqual([
      '파일에 학년별 문제가 없어요.',
    ]);
    const twice = {
      format: FINAL_UPLOAD_FORMAT,
      sets: [file().sets[0], file().sets[0], { grade: 7, questions: [] }],
    };
    const { sets, errors } = parseFinalQuestionUpload(twice);
    expect(sets).toEqual([]);
    expect(errors).toEqual([
      '4학년 문제가 두 번 들어 있어요.',
      '학년은 3, 4, 5, 6 중 하나여야 해요.',
    ]);
  });

  it('고칠 곳을 한 번에 모두 알려 준다', () => {
    const questions = Array.from({ length: 10 }, (_, i) => question(i + 1));
    questions[0] = question(1, { text: ' ', area: 'magic' });
    questions[1] = question(2, { choices: ['가', '나', '다'] });
    questions[2] = question(3, { answer: 5, hintRemove: '②' });
    questions[3] = question(4, { image: { src: 'javascript:alert(1)', alt: 'x' } });
    const { sets, errors } = parseFinalQuestionUpload(file(questions));
    expect(sets).toEqual([]);
    expect(errors).toEqual([
      '4학년 1번 문제: 문제 글이 없어요.',
      '4학년 1번 문제: 영역은 생각·관찰·표현·명령·검증 중 하나여야 해요.',
      '4학년 2번 문제: 보기는 4개를 모두 적어야 해요.',
      '4학년 3번 문제: 정답은 1~4 중 하나여야 해요.',
      '4학년 4번 문제: 그림은 data URL이나 앱 안의 경로여야 해요.',
    ]);
  });

  it('힌트가 정답을 지우거나 문제 수가 다르면 학년 단위로 거부한다', () => {
    const questions = Array.from({ length: 10 }, (_, i) => question(i + 1));
    questions[4] = question(5, { answer: 3, hintRemove: 3 });
    expect(parseFinalQuestionUpload(file(questions)).errors).toEqual([
      '4학년: 5번 문제: 힌트는 정답 보기를 지우면 안 돼요.',
    ]);
    expect(parseFinalQuestionUpload(file(questions.slice(0, 9))).errors).toEqual([
      '4학년: 최종 미션은 10문제여야 해요. (지금 9문제)',
    ]);
  });

  it('너무 큰 그림은 받지 않는다', () => {
    const questions = Array.from({ length: 10 }, (_, i) => question(i + 1));
    questions[0] = question(1, {
      image: { src: `data:image/png;base64,${'A'.repeat(500_000)}`, alt: '큰 그림' },
    });
    expect(parseFinalQuestionUpload(file(questions)).errors[0]).toMatch(/그림이 너무 커요/);
  });
});

describe('문제를 바꿀 수 있는 때', () => {
  it('잠긴 학년에 시작한 반이 없을 때만 바꿀 수 있다', () => {
    const locked = emptyFinalSession(5);
    expect(getQuestionReplaceBlocker(locked, [{ startedAt: null }])).toBeNull();
    expect(getQuestionReplaceBlocker(locked, [{ startedAt: 1 }])).toMatch(/이미 시작한 반/);
    expect(getQuestionReplaceBlocker({ ...locked, status: 'open' }, [])).toMatch(/이미 열려 있어/);
    expect(getQuestionReplaceBlocker({ ...locked, status: 'results_published' }, [])).toMatch(
      /이미 열려 있어/,
    );
  });
});
