import { useEffect, useRef } from 'react';
import { useSettings } from '../app/SettingsContext';

/**
 * 마지막 10초에는 1초마다 똑딱 소리를, 0초가 되면 종료 소리를 낸다.
 * 시간이 줄어드는 순간에만 울리므로, 화면을 열었을 때 이미 끝난 시간에는 소리가 나지 않는다.
 */
export function useCountdownSound(seconds: number | null, enabled = true): void {
  const { playEffect } = useSettings();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = seconds;
    if (!enabled || seconds === null || before === null || seconds >= before) return;
    if (seconds === 0) playEffect('timeup');
    else if (seconds <= 10) playEffect('tick');
  }, [seconds, enabled, playEffect]);
}
