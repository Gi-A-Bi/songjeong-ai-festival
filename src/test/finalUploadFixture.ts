import { FINAL_UPLOAD_FORMAT } from '../domain/finalQuestionUpload';
import type { Grade } from '../domain/types';

/** 테스트용 작은 그림(1×1 PNG의 앞부분). 실제로 그려지지 않아도 되고 data URL 형식만 맞으면 된다. */
export const FIXTURE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * npm run final:build가 만드는 것과 같은 모양의 올리기 파일.
 * 3번 문제에 그림을 넣고, 정답은 모두 2번(b), 힌트로 지울 보기는 4번(d)이다.
 */
export function buildUploadFile(grades: readonly Grade[]) {
  return {
    format: FINAL_UPLOAD_FORMAT,
    version: 1,
    createdAt: '2026-09-24T00:00:00.000Z',
    sets: grades.map((grade) => ({
      grade,
      questions: Array.from({ length: 10 }, (_, index) => {
        const no = index + 1;
        return {
          id: `q${no}`,
          no,
          area: ['thinking', 'observation', 'expression', 'command', 'verification'][index % 5],
          category: `${grade}학년 유형 ${no}`,
          text: `${grade}학년 ${no}번 문제입니다.`,
          passage: no === 2 ? `${grade}학년 제시문` : null,
          image: no === 3 ? { src: FIXTURE_IMAGE, alt: `${grade}학년 3번 그림` } : null,
          choices: [`보기 가 ${no}`, `보기 나 ${no}`, `보기 다 ${no}`, `보기 라 ${no}`],
          answer: 2,
          hintRemove: 4,
          explanation: `${no}번 해설`,
        };
      }),
    })),
  };
}
