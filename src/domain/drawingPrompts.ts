import type { DrawingConfig, DrawingGradeBand, DrawingPrompt, Grade } from './types';

/**
 * ‘AI 설명대로 그려라 – 명화 속으로 들어간 AI’의 기본 그림 프롬프트(운영 계획 5장).
 * 모든 프롬프트는 ①명화 ②장면 요소와 개수 ③위치·구도 ④화풍 ⑤색채 조건 ⑥AI 시대 재해석 요소를 담는다.
 * 명화는 저작권 보호 기간이 지난 작품만 쓴다.
 */
export const DEFAULT_DRAWING_PROMPTS: readonly DrawingPrompt[] = [
  {
    id: 'starry-night',
    gradeBand: 'grade34',
    optionNo: 1,
    artist: '반 고흐',
    artwork: '별이 빛나는 밤',
    technique: '소용돌이치는 굵은 붓 터치',
    text: '반 고흐의 〈별이 빛나는 밤〉처럼 하늘 전체를 소용돌이치는 굵은 붓 터치로 표현해요. 하늘에는 노란 별 11개와 오른쪽 위에 초승달 1개가 떠 있어요. 왼쪽 앞에는 원작의 사이프러스 나무 대신 머리에 안테나가 달린 키 큰 AI 로봇이 서 있고, 아래쪽 마을 한가운데에는 창문에 불이 켜진 우리 학교 건물이 있어요. 색은 짙은 파랑과 노랑 두 가지 계열만 사용해요.',
    imageKey: 'artworkStarryNight',
  },
  {
    id: 'gleaners',
    gradeBand: 'grade34',
    optionNo: 2,
    artist: '밀레',
    artwork: '이삭 줍는 여인들',
    technique: '부드러운 붓질과 따뜻한 흙빛 색',
    text: '밀레의 〈이삭 줍는 여인들〉 속 넓은 황금빛 들판을 배경으로 해요. 원작의 허리를 굽힌 세 사람 대신, 바구니를 든 로봇 세 대가 왼쪽부터 키 순서대로(큰 로봇 → 작은 로봇) 나란히 서서 이삭을 줍고 있어요. 멀리 뒤쪽 하늘에는 드론 두 대가 날고, 오른쪽 끝에는 짚더미가 쌓여 있어요. 하늘은 연한 노란빛, 땅은 황토색으로 칠해요.',
    imageKey: 'artworkGleaners',
  },
  {
    id: 'ssireum',
    gradeBand: 'grade56',
    optionNo: 1,
    artist: '김홍도',
    artwork: '씨름',
    technique: '배경 없이 먹선으로 그린 옛 그림',
    text: '김홍도의 〈씨름〉처럼 화면 가운데에서 두 선수가 씨름을 하고, 구경꾼들이 둥글게 둘러앉아 있어요. 두 선수 중 왼쪽은 사람, 오른쪽은 AI 로봇이에요. 오른쪽 위 구경꾼 한 명은 태블릿으로 경기를 촬영하고, 원작의 엿장수 대신 구경꾼 무리 바깥 왼쪽 아래에는 AI 스피커를 든 아이가 서 있어요. 배경은 그리지 않고, 먹선 느낌의 검은 선과 옅은 황토색만 사용해 옛 그림처럼 표현해요.',
    imageKey: 'artworkSsireum',
  },
  {
    id: 'grande-jatte',
    gradeBand: 'grade56',
    optionNo: 2,
    artist: '쇠라',
    artwork: '그랑드자트섬의 일요일 오후',
    technique: '선 없이 작은 점을 찍는 점묘법',
    text: '쇠라처럼 선을 쓰지 않고 작은 점만 찍어서(점묘법) 그려요. 강가 공원 잔디밭 오른쪽에는 양산을 쓴 사람 2명과 강아지 1마리가 있고, 왼쪽 강 위에는 지붕에 태양광 패널을 단 무인 배 한 척이 떠 있어요. 가운데 나무 그늘 아래 벤치에는 로봇이 앉아 책을 읽고 있어요. 초록, 파랑, 주황 세 가지 색의 점만 사용해요.',
    imageKey: 'artworkGrandeJatte',
  },
];

export const DRAWING_GRADE_BAND_LABELS: Record<DrawingGradeBand, string> = {
  grade34: '3~4학년',
  grade56: '5~6학년',
};

export function getDrawingGradeBand(grade: Grade): DrawingGradeBand {
  return grade <= 4 ? 'grade34' : 'grade56';
}

const OPTION_MARKS = ['①', '②', '③', '④', '⑤'];

/** 학년군 안의 번호 표시(①, ②) */
export function drawingOptionMark(prompt: Pick<DrawingPrompt, 'optionNo'>): string {
  return OPTION_MARKS[prompt.optionNo - 1] ?? `${prompt.optionNo}.`;
}

/** 화면에 쓰는 작품 이름: 반 고흐 〈별이 빛나는 밤〉 */
export function drawingArtworkLabel(prompt: Pick<DrawingPrompt, 'artist' | 'artwork'>): string {
  return `${prompt.artist} 〈${prompt.artwork}〉`;
}

export function createDefaultDrawingConfig(): DrawingConfig {
  return {
    type: 'drawing',
    prompts: DEFAULT_DRAWING_PROMPTS.map((prompt) => ({ ...prompt })),
    selectedPromptIds: {},
  };
}

/** 그 학년이 고를 수 있는 프롬프트(같은 학년군의 후보)를 번호 순으로 돌려준다. */
export function listDrawingPromptOptions(config: DrawingConfig, grade: Grade): DrawingPrompt[] {
  const band = getDrawingGradeBand(grade);
  return config.prompts
    .filter((prompt) => prompt.gradeBand === band)
    .sort((a, b) => a.optionNo - b.optionNo);
}

/** 그 학년이 그릴 프롬프트. 아직 고르지 않았으면 학년군의 첫 번째 후보다. */
export function resolveDrawingPrompt(config: DrawingConfig, grade: Grade): DrawingPrompt | null {
  const options = listDrawingPromptOptions(config, grade);
  const selectedId = config.selectedPromptIds[grade];
  return options.find((prompt) => prompt.id === selectedId) ?? options[0] ?? null;
}

/** 프롬프트를 고른 설정. 그 학년의 후보가 아니면 null */
export function selectDrawingPrompt(
  config: DrawingConfig,
  grade: Grade,
  promptId: string,
): DrawingConfig | null {
  if (!listDrawingPromptOptions(config, grade).some((prompt) => prompt.id === promptId)) {
    return null;
  }
  return { ...config, selectedPromptIds: { ...config.selectedPromptIds, [grade]: promptId } };
}

export function getDrawingConfigError(config: DrawingConfig): string | null {
  if (!Array.isArray(config.prompts) || config.prompts.length === 0) {
    return '그림 프롬프트가 하나도 없어요.';
  }
  const ids = new Set(config.prompts.map((prompt) => prompt.id));
  if (ids.size !== config.prompts.length) return '그림 프롬프트 ID가 겹쳐요.';
  if (config.prompts.some((prompt) => prompt.text.trim() === '')) {
    return '내용이 빈 그림 프롬프트가 있어요.';
  }
  for (const grade of [3, 4, 5, 6] as const) {
    if (listDrawingPromptOptions(config, grade).length === 0) {
      return `${grade}학년이 그릴 그림 프롬프트가 없어요.`;
    }
    const selectedId = config.selectedPromptIds[grade];
    if (selectedId !== undefined && resolveDrawingPrompt(config, grade)?.id !== selectedId) {
      return `${grade}학년에 고른 그림 프롬프트가 그 학년의 후보가 아니에요.`;
    }
  }
  return null;
}

// ---- AI 심사 기준(10점 만점) ----

export type DrawingRubricId = 'elements' | 'layout' | 'style' | 'color' | 'reinterpretation';

export interface DrawingRubricItem {
  id: DrawingRubricId;
  name: string;
  description: string;
  max: number;
}

/** 그림 실력이 아니라 프롬프트의 조건을 얼마나 정확하게 표현했는지를 본다. */
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
