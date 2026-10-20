import type {
  DrawingConfig,
  DrawingCriteria,
  DrawingPrompt,
  DrawingRubricId,
  Grade,
} from './types';

export type { DrawingCriteria, DrawingRubricId } from './types';

/**
 * ‘AI 설명대로 그려라 – 명화 속으로 들어간 AI’의 학년별 그림 프롬프트(운영 계획 5장).
 * 학년마다 명화 한 점이 정해져 있고(2026-10-20 고정), 학년이 올라갈수록 조건이 많고 기법이 어렵다.
 *   3학년 밀레(개수와 자리) → 4학년 반 고흐(11개 세기·두 색) → 5학년 김홍도(여러 인물 배치·먹선)
 *   → 6학년 쇠라(점묘법·구도 비율·세 색)
 * 모든 프롬프트는 ①명화 ②장면 요소와 개수 ③위치·구도 ④화풍 ⑤색채 조건 ⑥AI 시대 재해석 요소를 담고,
 * 심사 영역마다 그 그림에서 확인할 조건(criteria)을 적어 둔다. 명화는 저작권 보호 기간이 지난 작품만 쓴다.
 */
export const DEFAULT_DRAWING_PROMPTS: readonly DrawingPrompt[] = [
  {
    id: 'gleaners',
    grade: 3,
    artist: '밀레',
    artwork: '이삭 줍는 여인들',
    technique: '부드러운 붓질과 따뜻한 흙빛 색',
    focus: '그려야 할 것의 개수와 자리를 정확히 맞추기',
    text: '밀레의 〈이삭 줍는 여인들〉처럼 넓은 황금빛 들판을 그려요. 들판 가운데에는 허리를 굽힌 세 사람 대신 바구니를 든 로봇 3대가 나란히 서서 이삭을 줍고 있어요. 하늘에는 드론 2대가 날고, 오른쪽 끝에는 짚더미가 쌓여 있어요. 하늘은 연한 노란색, 땅은 황토색으로 칠해요.',
    criteria: {
      elements: '바구니를 든 로봇 3대, 드론 2대, 짚더미 1개가 모두 있고 개수가 맞는가',
      layout: '로봇은 들판 가운데에 나란히, 드론은 하늘에, 짚더미는 오른쪽 끝에 있는가',
      style: '밀레처럼 들판이 화면을 넓게 차지하고 부드러운 붓질로 칠했는가',
      color: '하늘은 연한 노란색, 땅은 황토색으로 칠했는가',
      reinterpretation: '사람 대신 로봇이 이삭을 줍고 드론이 나는 장면이 자연스러운가',
    },
    imageKey: 'artworkGleaners',
  },
  {
    id: 'starry-night',
    grade: 4,
    artist: '반 고흐',
    artwork: '별이 빛나는 밤',
    technique: '소용돌이치는 굵은 붓 터치',
    focus: '별 11개 세기, 로봇과 학교의 자리, 두 가지 색만 쓰기',
    text: '반 고흐의 〈별이 빛나는 밤〉처럼 밤하늘 전체를 소용돌이치는 굵은 붓 터치로 표현해요. 하늘에는 노란 별 11개와 오른쪽 위에 초승달 1개가 떠 있어요. 왼쪽 앞에는 원작의 사이프러스 나무 대신 머리에 안테나가 달린 키 큰 AI 로봇이 서 있고, 아래쪽 마을 한가운데에는 창문에 불이 켜진 우리 학교 건물이 있어요. 색은 짙은 파랑과 노랑 두 가지 계열만 사용해요.',
    criteria: {
      elements:
        '별 11개, 초승달 1개, 안테나 달린 AI 로봇 1대, 창문에 불이 켜진 학교 건물 1채가 있고 개수가 맞는가',
      layout: '초승달은 오른쪽 위, 로봇은 왼쪽 앞에 키 크게, 학교는 아래쪽 마을 한가운데에 있는가',
      style: '하늘 전체가 소용돌이치는 굵은 붓 터치로 표현되었는가',
      color: '짙은 파랑과 노랑 두 가지 계열의 색만 썼는가',
      reinterpretation: '사이프러스 나무 자리에 로봇, 마을에 우리 학교가 자연스럽게 들어갔는가',
    },
    imageKey: 'artworkStarryNight',
  },
  {
    id: 'ssireum',
    grade: 5,
    artist: '김홍도',
    artwork: '씨름',
    technique: '배경 없이 먹선으로 그린 옛 그림',
    focus: '여러 인물을 둥글게 배치하기, 정한 자리에 정한 인물 넣기, 먹선 느낌 살리기',
    text: '김홍도의 〈씨름〉처럼 화면 가운데에서 두 선수가 씨름을 하고, 구경꾼들이 둥글게 둘러앉아 있어요. 두 선수 중 왼쪽은 사람, 오른쪽은 AI 로봇이에요. 구경꾼은 6명 이상 그리고, 오른쪽 위 구경꾼 한 명은 태블릿으로 경기를 촬영해요. 원작의 엿장수 대신 구경꾼 무리 바깥 왼쪽 아래에는 AI 스피커를 든 아이가 서 있어요. 배경은 그리지 않고, 먹선 느낌의 검은 선과 옅은 황토색만 사용해 옛 그림처럼 표현해요.',
    criteria: {
      elements:
        '씨름 선수 2명(사람 1, 로봇 1), 구경꾼 6명 이상, 태블릿으로 촬영하는 구경꾼 1명, AI 스피커를 든 아이 1명이 있는가',
      layout:
        '선수는 화면 가운데(왼쪽 사람·오른쪽 로봇), 구경꾼은 둥글게, 촬영하는 구경꾼은 오른쪽 위, 스피커 든 아이는 무리 바깥 왼쪽 아래에 있는가',
      style: '배경 없이 먹선 느낌의 검은 선으로 옛 그림처럼 그렸는가',
      color: '검은 선과 옅은 황토색만 썼는가',
      reinterpretation: '로봇 선수, 태블릿, AI 스피커가 옛 그림 장면에 자연스럽게 어우러지는가',
    },
    imageKey: 'artworkSsireum',
  },
  {
    id: 'grande-jatte',
    grade: 6,
    artist: '쇠라',
    artwork: '그랑드자트섬의 일요일 오후',
    technique: '선 없이 작은 점을 찍는 점묘법',
    focus: '선 없이 점으로만 그리기, 위아래 구도 비율 지키기, 세 가지 색만 쓰기',
    text: '쇠라의 〈그랑드자트섬의 일요일 오후〉처럼 선을 쓰지 않고 작은 점만 찍어서(점묘법) 그려요. 화면 위쪽 3분의 1은 강과 하늘, 아래쪽 3분의 2는 잔디밭이에요. 잔디밭 오른쪽에는 양산을 쓴 사람 2명과 강아지 1마리가 있고, 왼쪽 강 위에는 지붕에 태양광 패널을 단 무인 배 1척이 떠 있어요. 가운데 나무 그늘 아래 벤치에는 로봇 1대가 앉아 책을 읽고 있어요. 초록, 파랑, 주황 세 가지 색의 점만 사용해요.',
    criteria: {
      elements:
        '양산 쓴 사람 2명, 강아지 1마리, 태양광 패널 단 무인 배 1척, 나무 1그루, 벤치에 앉아 책 읽는 로봇 1대가 있고 개수가 맞는가',
      layout:
        '위쪽 3분의 1이 강과 하늘, 아래쪽 3분의 2가 잔디밭이고, 사람·강아지는 오른쪽, 배는 왼쪽 강 위, 로봇은 가운데 나무 그늘 벤치에 있는가',
      style: '선을 쓰지 않고 작은 점만 찍어 표현했는가',
      color: '초록, 파랑, 주황 세 가지 색의 점만 썼는가',
      reinterpretation: '무인 배와 책 읽는 로봇이 공원 풍경에 자연스럽게 어우러지는가',
    },
    imageKey: 'artworkGrandeJatte',
  },
];

export const DRAWING_GRADES: readonly Grade[] = [3, 4, 5, 6];

/** 그 학년이 그리는 프롬프트. 학년마다 하나로 정해져 있다. */
export function getDrawingPrompt(grade: Grade): DrawingPrompt {
  const prompt = DEFAULT_DRAWING_PROMPTS.find((item) => item.grade === grade);
  if (!prompt) throw new Error(`${grade}학년의 그림 프롬프트가 없어요.`);
  return prompt;
}

/** 화면에 쓰는 작품 이름: 반 고흐 〈별이 빛나는 밤〉 */
export function drawingArtworkLabel(prompt: Pick<DrawingPrompt, 'artist' | 'artwork'>): string {
  return `${prompt.artist} 〈${prompt.artwork}〉`;
}

/** 그리기 미션 설정. 프롬프트는 프로그램에 고정되어 있어 저장할 것이 없다. */
export function createDefaultDrawingConfig(): DrawingConfig {
  return { type: 'drawing' };
}

// ---- AI 심사 기준(10점 만점) ----

export interface DrawingRubricItem {
  id: DrawingRubricId;
  name: string;
  description: string;
  max: number;
}

/** 그림 실력이 아니라 프롬프트의 조건을 얼마나 정확하게 표현했는지를 본다. 배점은 전 학년 같다. */
export const DRAWING_RUBRIC: readonly DrawingRubricItem[] = [
  {
    id: 'elements',
    name: '요소·수량',
    description: '프롬프트에 나온 사물·인물·로봇이 모두 있고 개수가 맞는가',
    max: 3,
  },
  {
    id: 'layout',
    name: '위치·구도',
    description: '왼쪽·오른쪽·가운데·앞·뒤 등 배치가 프롬프트와 일치하는가',
    max: 2,
  },
  {
    id: 'style',
    name: '화풍 표현',
    description: '소용돌이 붓 터치, 점묘, 먹선 등 명화의 표현 기법을 살렸는가',
    max: 2,
  },
  {
    id: 'color',
    name: '색채 조건',
    description: '지정된 색만 사용하는 등 색 조건을 지켰는가',
    max: 2,
  },
  {
    id: 'reinterpretation',
    name: '재해석',
    description: 'AI 시대 요소가 명화 장면 속에 자연스럽게 어우러지는가',
    max: 1,
  },
];

export const DRAWING_MAX_SCORE = DRAWING_RUBRIC.reduce((sum, item) => sum + item.max, 0);

export type DrawingRubricScores = Partial<Record<DrawingRubricId, number>>;

/** 영역별 점수의 합. 입력하지 않은 영역은 0점으로 센다. */
export function sumDrawingRubric(scores: DrawingRubricScores): number {
  return DRAWING_RUBRIC.reduce(
    (sum, item) => sum + Math.min(item.max, Math.max(0, scores[item.id] ?? 0)),
    0,
  );
}

/** 심사 영역과 그 그림에서 확인할 조건을 짝지어 돌려준다(화면·요청문에 같은 순서로 쓴다). */
export function listDrawingCriteria(
  criteria: DrawingCriteria,
): { item: DrawingRubricItem; text: string }[] {
  return DRAWING_RUBRIC.map((item) => ({ item, text: criteria[item.id] }));
}
