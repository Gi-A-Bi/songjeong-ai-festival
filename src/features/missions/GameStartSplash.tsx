import { useEffect, useState } from 'react';
import { useSettings } from '../../app/SettingsContext';
import type { MissionPhase } from '../../domain/types';
import './GameStartSplash.css';

const SPLASH_MS = 1600;

/**
 * 기다리던 미션이 열리는 순간 “게임 시작!”을 잠깐 보여 준다.
 * 화면을 가리기만 하고 누르는 것은 막지 않는다. 남은 시간이 점수가 되는 미션이 있어
 * 어느 팀도 연출 때문에 늦게 시작하지 않게 한다.
 */
export function GameStartSplash({ phase }: { phase: MissionPhase | null }) {
  const { playEffect } = useSettings();
  const [seenPhase, setSeenPhase] = useState(phase);
  const [visible, setVisible] = useState(false);

  if (seenPhase !== phase) {
    setSeenPhase(phase);
    // 화면을 열었을 때 이미 게임 중이면 보여 주지 않는다.
    if (seenPhase === 'waiting' && phase === 'active') setVisible(true);
  }

  useEffect(() => {
    if (!visible) return undefined;
    playEffect('go');
    const id = window.setTimeout(() => setVisible(false), SPLASH_MS);
    return () => window.clearTimeout(id);
  }, [visible, playEffect]);

  if (!visible) return null;
  return (
    <div className="start-splash" role="status">
      <p className="start-splash__text">게임 시작!</p>
    </div>
  );
}

const ARRIVAL_MS = 1800;

/** 인증코드로 입장한 순간 “입장 완료!”를 잠깐 보여 준다. 소리는 입력 화면이 낸다. */
export function ArrivalSplash({ at, onDone }: { at: number | null; onDone: () => void }) {
  useEffect(() => {
    if (at === null) return undefined;
    const id = window.setTimeout(onDone, ARRIVAL_MS);
    return () => window.clearTimeout(id);
  }, [at, onDone]);

  if (at === null) return null;
  return (
    <div key={at} className="start-splash start-splash--arrival" role="status">
      <p className="start-splash__text">입장 완료!</p>
    </div>
  );
}
