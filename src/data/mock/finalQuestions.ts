import type { CardType, FinalQuestionConfig, FinalQuestionSet, Grade } from '../../domain/types';

interface SampleQuestion {
  area: CardType;
  text: string;
  passage?: string;
  /** 보기 4개. 순서대로 a, b, c, d */
  choices: [string, string, string, string];
  answer: 'a' | 'b' | 'c' | 'd';
  /** 힌트로 지울 오답 */
  remove: 'a' | 'b' | 'c' | 'd';
}

/**
 * 최종 미션 샘플 10문제(생각·관찰·표현·명령·검증 영역 2문제씩).
 * 실제 학년별 문제·정답·힌트로 지울 오답은 행사 전에 교사가 정한다(명세 24장).
 * 화면 컴포넌트는 이 파일을 직접 읽지 않고 저장소를 거쳐 문제만 받는다.
 */
const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    area: 'thinking',
    text: 'AI 로봇 가, 나, 다가 달리기를 했어요. 가는 나보다 빨랐고, 다는 가보다 빨랐어요. 가장 늦게 들어온 로봇은 누구일까요?',
    choices: ['로봇 가', '로봇 나', '로봇 다', '알 수 없어요'],
    answer: 'b',
    remove: 'd',
  },
  {
    area: 'thinking',
    text: '규칙을 찾아 □에 들어갈 수를 골라요.  2, 4, 8, 16, □',
    choices: ['18', '24', '32', '64'],
    answer: 'c',
    remove: 'a',
  },
  {
    area: 'observation',
    text: 'AI가 만든 사진인지 살펴볼 때 가장 먼저 확인하면 좋은 부분은 무엇일까요?',
    choices: [
      '손가락 개수, 그림자, 글자 같은 작은 부분',
      '사진의 크기',
      '사진을 올린 시간',
      '사진 색이 예쁜지',
    ],
    answer: 'a',
    remove: 'd',
  },
  {
    area: 'observation',
    text: '두 그림에서 서로 다른 곳을 빠짐없이 찾는 가장 좋은 방법은 무엇일까요?',
    choices: [
      '한 번 훑어보고 끝낸다',
      '구역을 나누어 차례로 비교한다',
      '눈을 감고 떠올려 본다',
      '친구 답을 그대로 쓴다',
    ],
    answer: 'b',
    remove: 'c',
  },
  {
    area: 'expression',
    text: 'AI가 그린 그림에서 나무가 집의 오른쪽에 있어요. 설명을 어떻게 고치면 좋을까요?',
    passage: 'AI에게 준 설명: “빨간 지붕 집 옆에 큰 나무 한 그루를 그려 줘.”',
    choices: [
      '더 큰 글씨로 다시 쓴다',
      '“집의 왼쪽에 나무”처럼 위치를 분명하게 쓴다',
      '색깔 설명을 모두 뺀다',
      '아무 설명 없이 다시 시킨다',
    ],
    answer: 'b',
    remove: 'a',
  },
  {
    area: 'expression',
    text: 'AI에게 원하는 그림을 얻으려면 설명에 꼭 넣어야 하는 것은 무엇일까요?',
    choices: ['무엇을, 몇 개, 어디에, 어떤 색으로', '지금 내 기분', '오늘의 날씨', '좋아하는 간식'],
    answer: 'a',
    remove: 'd',
  },
  {
    area: 'command',
    text: '로봇이 물 한 컵을 가져오게 하려고 해요. 알맞은 명령 순서는 무엇일까요?',
    passage: '① 컵에 물 따르기  ② 컵 꺼내기  ③ 컵 가져오기',
    choices: ['① → ② → ③', '② → ① → ③', '③ → ② → ①', '② → ③ → ①'],
    answer: 'b',
    remove: 'c',
  },
  {
    area: 'command',
    text: '아래 명령을 3번 반복하면 로봇은 “앞으로” 명령으로 모두 몇 칸 움직일까요?',
    passage: '앞으로 2칸 → 오른쪽으로 돌기 → 앞으로 1칸',
    choices: ['3칸', '6칸', '9칸', '12칸'],
    answer: 'c',
    remove: 'a',
  },
  {
    area: 'verification',
    text: 'AI가 “꿀벌의 다리는 8개”라고 알려 줬어요. 가장 좋은 행동은 무엇일까요?',
    choices: [
      '그대로 발표한다',
      '곤충 백과 같은 책에서 확인한다',
      '친구에게 그대로 알려 준다',
      'AI가 말했으니 믿는다',
    ],
    answer: 'b',
    remove: 'd',
  },
  {
    area: 'verification',
    text: '다음 중 가장 믿을 수 있는 자료는 무엇일까요?',
    choices: [
      '누가 썼는지 모르는 짧은 글',
      '광고 속 문구',
      '도서관의 어린이 과학 백과',
      '친구에게 들은 소문',
    ],
    answer: 'c',
    remove: 'd',
  },
];

const CHOICE_IDS = ['a', 'b', 'c', 'd'] as const;

export function createSampleFinalQuestionSet(grade: Grade): FinalQuestionSet {
  const questions: FinalQuestionConfig[] = SAMPLE_QUESTIONS.map((sample, index) => ({
    question: {
      id: `q${index + 1}`,
      area: sample.area,
      text: sample.text,
      passage: sample.passage ?? null,
      choices: sample.choices.map((label, choiceIndex) => ({
        id: CHOICE_IDS[choiceIndex],
        label,
      })),
    },
    answerChoiceId: sample.answer,
    hintRemoveChoiceId: sample.remove,
  }));
  return { grade, questions };
}
