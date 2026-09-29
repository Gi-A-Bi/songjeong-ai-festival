/** 파일에서 읽은 값이라 형식을 느슨하게 둔다. 테스트가 일부러 틀린 값을 넣어 볼 수 있다. */
export interface GoldenUploadFixture {
  format: string;
  version: number;
  createdAt: string;
  sets: { grades: number[]; questions: Record<string, unknown>[] }[];
}

/**
 * 골든벨 문제 파일(JSON) 예시. 테스트용으로 지어낸 문제이며 실제 행사 문제가 아니다.
 * 3학년 묶음과 5·6학년이 함께 쓰는 묶음이 들어 있다.
 */
export function createGoldenUploadFixture(): GoldenUploadFixture {
  return {
    format: 'songjeong-golden-bell-questions',
    version: 1,
    createdAt: '2026-09-29T00:00:00.000Z',
    sets: [
      {
        grades: [3],
        questions: [
          {
            id: 'g3-q1',
            kind: 'ox',
            level: 'low',
            area: 'AI 이해',
            question: '로봇 청소기는 스스로 움직이며 청소한다.',
            answer: 'O',
            explanation: null,
          },
          {
            id: 'g3-q2',
            kind: 'choice',
            level: 'mid',
            area: 'AI 윤리',
            question: '비밀번호를 물어보는 챗봇을 만나면 어떻게 할까요?',
            choices: ['바로 알려 준다', '알려 주지 않고 어른에게 말한다', '친구 것을 알려 준다'],
            answer: 2,
            explanation: '비밀번호는 누구에게도 알려 주지 않아요.',
          },
          {
            id: 'g3-q3',
            kind: 'short',
            level: 'high',
            area: 'AI 활용',
            question: '글자를 입력하는 판의 이름은?',
            hint: '초성 ㅋㅂㄷ',
            answer: '키보드',
            accept: ['자판', 'Keyboard'],
            explanation: null,
          },
        ],
      },
      {
        grades: [5, 6],
        questions: [
          {
            id: 'g56-q1',
            kind: 'ox',
            level: '하',
            area: 'AI 이해',
            question: '컴퓨터는 전기가 없어도 켜진다.',
            answer: 'X',
          },
          {
            id: 'g56-q2',
            kind: 'short',
            level: '상',
            area: 'AI 이해',
            question: '화면을 손가락으로 눌러 쓰는 기기는?',
            answer: '태블릿',
            accept: ['태블릿 PC'],
          },
        ],
      },
    ],
  };
}
