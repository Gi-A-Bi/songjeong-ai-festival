import { Outlet } from 'react-router';
import { useStageTheme } from '../hooks/useStageTheme';

/** 학생이 보는 화면(시작·팀 입장·팀 홈·미션·카드)을 남색 무대 테마로 감싼다. */
export function StageLayout() {
  useStageTheme();
  return <Outlet />;
}
