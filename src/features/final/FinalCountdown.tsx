import { useEffect, useRef, useState } from 'react';
import { FINAL_COUNTDOWN_SECONDS } from '../../config';
import './Final.css';

/** “3, 2, 1, 시작!” 카운트다운. 끝나는 시점에 onDone을 한 번만 부른다. */
export function FinalCountdown({ onDone }: { onDone: () => void }) {
  const [left, setLeft] = useState(FINAL_COUNTDOWN_SECONDS);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const id = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // 0이 되면 “시작!”을 잠깐 보여 준 뒤 시작을 기록한다.
    if (left > 0 || done.current) return undefined;
    done.current = true;
    const id = window.setTimeout(() => onDoneRef.current(), 600);
    return () => window.clearTimeout(id);
  }, [left]);

  const label = left > 0 ? String(left) : '시작!';
  return (
    <div
      className="final-countdown"
      role="alertdialog"
      aria-modal="true"
      aria-label="시작 카운트다운"
    >
      <p className="final-countdown__label">최종 미션을 시작해요</p>
      <p key={label} className="final-countdown__number number" aria-live="assertive">
        {label}
      </p>
    </div>
  );
}
