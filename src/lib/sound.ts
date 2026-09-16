/** 효과음은 파일 없이 Web Audio로 짧게 만든다. 소리 없이도 의미는 화면에 표시된다. */
export type SoundEffect = 'tap' | 'success' | 'card' | 'error';

const NOTES: Record<SoundEffect, number[]> = {
  tap: [660],
  success: [523, 659, 784],
  card: [392, 523, 659, 1046],
  error: [330, 247],
};

type AudioContextConstructor = typeof AudioContext;

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Constructor: AudioContextConstructor | undefined =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!Constructor) return null;
  audioContext = new Constructor();
  return audioContext;
}

export function playSound(effect: SoundEffect): void {
  try {
    const context = getAudioContext();
    if (!context) return;
    NOTES[effect].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
    });
  } catch {
    // 소리를 낼 수 없는 기기에서는 효과음을 생략한다.
  }
}
