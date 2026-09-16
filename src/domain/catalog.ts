import type { IconName } from '../components/icons';
import type { CardType, MissionType } from './types';

/** 카드 5종의 고정 정보(명세 7장) */
export const CARD_INFO: Record<
  CardType,
  { name: string; meaning: string; missionType: MissionType }
> = {
  thinking: { name: '생각 카드', meaning: '질문하고 판단하는 힘', missionType: 'golden_bell' },
  observation: {
    name: '관찰 카드',
    meaning: '자세히 보고 차이를 찾는 힘',
    missionType: 'error_hunt',
  },
  expression: { name: '표현 카드', meaning: '생각을 그림으로 나타내는 힘', missionType: 'drawing' },
  command: {
    name: '명령 카드',
    meaning: '순서와 규칙으로 움직이게 하는 힘',
    missionType: 'ozobot',
  },
  verification: {
    name: '검증 카드',
    meaning: '근거를 찾아 사실을 확인하는 힘',
    missionType: 'library_check',
  },
};

/** 미션 유형별 화면 표현 정보. 문제·교실 같은 행사 콘텐츠는 저장소의 미션 설정에 둔다. */
export const MISSION_TYPE_INFO: Record<MissionType, { icon: IconName; accent: string }> = {
  golden_bell: { icon: 'notifications_active', accent: 'golden-bell' },
  error_hunt: { icon: 'search', accent: 'error-hunt' },
  drawing: { icon: 'brush', accent: 'drawing' },
  ozobot: { icon: 'smart_toy', accent: 'ozobot' },
  library_check: { icon: 'menu_book', accent: 'library-check' },
};
