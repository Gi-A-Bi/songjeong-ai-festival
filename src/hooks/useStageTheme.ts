import { useLayoutEffect } from 'react';

/**
 * 학생 화면과 전자칠판 최종 미션은 남색 무대 테마로 보여 준다.
 * 색은 tokens.css의 [data-theme='stage']가 바꾸고, 화면을 떠나면 밝은 기본 테마로 돌아간다.
 */
export function useStageTheme(enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;
    root.dataset.theme = 'stage';
    return () => {
      delete root.dataset.theme;
    };
  }, [enabled]);
}
