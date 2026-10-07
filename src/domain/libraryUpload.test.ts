import { describe, expect, it } from 'vitest';
import {
  describeLibraryUploadQuestion,
  LIBRARY_UPLOAD_FORMAT,
  LIBRARY_UPLOAD_VERSION,
  parseLibraryUpload,
} from './libraryUpload';

/** 올린 파일을 자유롭게 고치는 테스트용 모양 */
interface LooseUpload {
  sets: { grades: number[]; questions: Record<string, unknown>[] }[];
}

/** 테스트용 지어낸 문제. 실제 문제는 content/작성에만 둔다. */
export function createLibraryUploadFixture() {
  return {
    format: LIBRARY_UPLOAD_FORMAT,
    version: LIBRARY_UPLOAD_VERSION,
    pickOne: true,
    sets: [
      {
        grades: [3],
        questions: [
          {
            type: 'choose',
            prompt: '자석에 대해 알려 줘',
            subject: '과학',
            title: 'AI가 쓴 “자석” 소개 글',
            sentences: ['자석은 철을 끌어당겨요.', '나침반 바늘의 N극은 남쪽을 가리켜요.'],
            wrong: '②',
            accept: ['북쪽'],
          },
          {
            type: 'choose',
            prompt: '속담에 대해 알려 줘',
            subject: '우리말',
            title: 'AI가 쓴 “속담” 소개 글',
            sentences: [
              '티끌 모아 태산은 작은 것도 모으면 커진다는 뜻이에요.',
              '우물 안 개구리는 개구리를 좋아하는 사람이에요.',
            ],
            wrong: 2,
            accept: '넓은 세상, 세상을 모르',
          },
        ],
      },
      {
        grades: [4, 5, 6],
        questions: [
          {
            type: 'find',
            prompt: '꿀벌에 대해 알려 줘',
            subject: '과학',
            title: 'AI가 쓴 “꿀벌” 소개 글',
            passage: '꿀벌은 다리가 8개인 곤충이에요.',
            wrongPartAccept: ['8개'],
            accept: ['6개'],
          },
        ],
      },
    ],
  };
}

describe('도서관 오류찾기 문제 파일', () => {
  it('학년 묶음을 읽어 설정으로 바꾸고, 여러 학년이 한 묶음을 같이 쓰면 학년마다 같은 문제를 둔다', () => {
    const result = parseLibraryUpload(createLibraryUploadFixture());
    expect(result.errors).toEqual([]);
    expect(result.config).toMatchObject({
      type: 'library_check',
      pickOne: true,
      questions: [],
    });
    expect(result.config?.gradeQuestions?.[3]).toEqual([
      {
        id: 'g3q1',
        type: 'choose',
        title: 'AI가 쓴 “자석” 소개 글',
        prompt: '자석에 대해 알려 줘',
        subject: '과학',
        sentences: ['자석은 철을 끌어당겨요.', '나침반 바늘의 N극은 남쪽을 가리켜요.'],
        answerKey: { wrongIndex: 1, correctionKeywords: ['북쪽'] },
      },
      expect.objectContaining({
        id: 'g3q2',
        answerKey: { wrongIndex: 1, correctionKeywords: ['넓은 세상', '세상을 모르'] },
      }),
    ]);
    expect(result.config?.gradeQuestions?.[4]?.[0]).toMatchObject({
      id: 'g4q1',
      type: 'find',
      answerKey: { wrongPartKeywords: ['8개'], correctionKeywords: ['6개'] },
    });
    expect(result.config?.gradeQuestions?.[5]?.[0].id).toBe('g5q1');
    expect(result.config?.gradeQuestions?.[6]?.[0].id).toBe('g6q1');
    expect(result.sets.map((set) => set.grades)).toEqual([[3], [4, 5, 6]]);
    expect(describeLibraryUploadQuestion(result.sets[0].questions[0])).toBe(
      '[과학] 자석에 대해 알려 줘 → AI가 쓴 “자석” 소개 글 (문장 2개, 틀린 문장 ②)',
    );
  });

  it('다른 파일이나 고칠 곳이 있는 파일은 아무것도 넣지 않고 이유를 알려 준다', () => {
    expect(parseLibraryUpload({ format: 'other' }).errors[0]).toMatch(/문제 파일이 아니에요/);
    expect(parseLibraryUpload({ format: LIBRARY_UPLOAD_FORMAT, version: 9 }).errors[0]).toMatch(
      /버전/,
    );
    const fixture = createLibraryUploadFixture() as unknown as LooseUpload;
    fixture.sets[0].questions[0].wrong = '⑤';
    fixture.sets[0].questions[1].accept = '';
    fixture.sets.push({ grades: [3], questions: [fixture.sets[1].questions[0]] });
    const result = parseLibraryUpload(fixture);
    expect(result.config).toBeNull();
    expect(result.sets).toEqual([]);
    expect(result.errors).toEqual([
      '3학년 1번 문제: 틀린 문장 번호는 1~2 중 하나여야 해요.',
      '3학년 2번 문제: 바르게 고친 내용으로 인정하는 말이 없어요.',
      '3학년: 같은 학년의 문제 묶음이 두 번 들어 있어요.',
    ]);
    // 공통 문제가 없으면 네 학년 모두 있어야 한다.
    const partial = createLibraryUploadFixture() as unknown as LooseUpload;
    partial.sets.pop();
    expect(parseLibraryUpload(partial).errors).toEqual([
      '공통 문제가 없으면 4·5·6학년 문제도 넣어 주세요.',
    ]);
  });
});
