import type { CardType, MissionType } from '../domain/types';

/**
 * 이미지 경로는 이 파일에서만 관리한다.
 * alt가 빈 문자열이면 장식 이미지로 취급한다.
 */
export interface AssetInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const base = import.meta.env.BASE_URL;
const festival = (file: string) => `${base}assets/festival/${file}`;

const WIDE = { width: 1600, height: 900 } as const;
const CARD = { width: 720, height: 1080 } as const;
const MASCOT = { width: 512, height: 512 } as const;

export const assets = {
  schoolLogo: {
    src: `${base}assets/brand/school-logo.png`,
    alt: '서울송정초등학교 로고',
    width: 382,
    height: 355,
  },
  heroMain: {
    src: festival('hero-main.webp'),
    alt: '아이들과 로봇이 태블릿을 들고 AI 미션 교실로 달려가는 페스티벌 장면',
    ...WIDE,
  },
  missionGoldenBell: {
    src: festival('mission-goldenbell.webp'),
    alt: 'AI 골든벨 미션 교실 장면',
    ...WIDE,
  },
  missionErrorHunt: {
    src: festival('mission-error-hunt.webp'),
    alt: '아이들이 돋보기로 AI 그림 속 이상한 곳을 찾는 장면',
    ...WIDE,
  },
  missionDrawing: {
    src: festival('mission-draw.webp'),
    alt: 'AI 설명대로 그려라 미션 교실 장면',
    ...WIDE,
  },
  missionOzobot: {
    src: festival('mission-ozobot.webp'),
    alt: '로봇 길찾기 미션 코스 장면',
    ...WIDE,
  },
  missionLibraryCheck: {
    src: festival('mission-library-check.webp'),
    alt: '도서관 책으로 AI 정보의 오류를 확인하는 장면',
    ...WIDE,
  },
  cardThinking: { src: festival('card-thinking.webp'), alt: '생각 카드', ...CARD },
  cardObservation: { src: festival('card-observation.webp'), alt: '관찰 카드', ...CARD },
  cardExpression: { src: festival('card-expression.webp'), alt: '표현 카드', ...CARD },
  cardCommand: { src: festival('card-command.webp'), alt: '명령 카드', ...CARD },
  cardVerification: { src: festival('card-verification.webp'), alt: '검증 카드', ...CARD },
  sceneFinale: {
    src: festival('scene-finale.webp'),
    alt: '학급 최종 미션을 축하하는 피날레 무대 장면',
    ...WIDE,
  },
  mascotWelcome: {
    src: festival('mascot-welcome.webp'),
    alt: '손을 흔드는 로봇 마스코트',
    ...MASCOT,
  },
  mascotCorrect: { src: festival('mascot-correct.webp'), alt: '기뻐하는 로봇 마스코트', ...MASCOT },
  mascotRetry: {
    src: festival('mascot-retry.webp'),
    alt: '다시 해 보자는 로봇 마스코트',
    ...MASCOT,
  },
  mascotTimer: {
    src: festival('mascot-timer.webp'),
    alt: '시간을 알려 주는 로봇 마스코트',
    ...MASCOT,
  },
  mascotHint: { src: festival('mascot-hint.webp'), alt: '힌트를 주는 로봇 마스코트', ...MASCOT },
  mascotCardEarned: {
    src: festival('mascot-card-earned.webp'),
    alt: '카드를 얻어 신난 로봇 마스코트',
    ...MASCOT,
  },
} as const satisfies Record<string, AssetInfo>;

export type AssetKey = keyof typeof assets;

export const missionImageKeys: Record<MissionType, AssetKey> = {
  golden_bell: 'missionGoldenBell',
  error_hunt: 'missionErrorHunt',
  drawing: 'missionDrawing',
  ozobot: 'missionOzobot',
  library_check: 'missionLibraryCheck',
};

export const cardImageKeys: Record<CardType, AssetKey> = {
  thinking: 'cardThinking',
  observation: 'cardObservation',
  expression: 'cardExpression',
  command: 'cardCommand',
  verification: 'cardVerification',
};

export function getAsset(key: AssetKey): AssetInfo {
  return assets[key];
}
