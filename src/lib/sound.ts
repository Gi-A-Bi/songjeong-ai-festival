/** 효과음은 파일 없이 Web Audio로 짧게 만든다. 소리 없이도 의미는 화면에 표시된다. */
export type SoundEffect =
  | 'tap'
  | 'success'
  | 'card'
  | 'error'
  /** 마지막 10초에 1초마다 */
  | 'tick'
  /** 시간이 끝났을 때 */
  | 'timeup'
  /** 시작 카운트다운의 3, 2, 1 */
  | 'count'
  /** “시작!” */
  | 'go'
  /** 교실 입장 완료 */
  | 'arrive'
  /** 카드 완성, 최종 미션 제출 */
  | 'fanfare';

interface SoundShape {
  /** 차례로 울릴 음의 주파수(Hz) */
  notes: number[];
  /** 음 사이 간격(초) */
  step: number;
  /** 음 하나의 길이(초) */
  length: number;
  /** 가장 큰 소리 크기(0~1). 교실에서 여러 기기가 함께 울리므로 작게 잡는다. */
  gain: number;
  wave: OscillatorType;
}

const SOUNDS: Record<SoundEffect, SoundShape> = {
  tap: { notes: [660], step: 0.09, length: 0.18, gain: 0.12, wave: 'triangle' },
  success: { notes: [523, 659, 784], step: 0.09, length: 0.25, gain: 0.16, wave: 'triangle' },
  card: { notes: [392, 523, 659, 1046], step: 0.09, length: 0.25, gain: 0.16, wave: 'triangle' },
  error: { notes: [330, 247], step: 0.12, length: 0.25, gain: 0.14, wave: 'triangle' },
  tick: { notes: [880], step: 0.09, length: 0.08, gain: 0.1, wave: 'square' },
  timeup: { notes: [523, 392, 262], step: 0.16, length: 0.35, gain: 0.16, wave: 'triangle' },
  count: { notes: [523], step: 0.09, length: 0.22, gain: 0.16, wave: 'sine' },
  go: { notes: [784, 1046], step: 0.1, length: 0.4, gain: 0.18, wave: 'triangle' },
  arrive: { notes: [659, 880], step: 0.1, length: 0.25, gain: 0.14, wave: 'sine' },
  fanfare: {
    notes: [523, 659, 784, 1046, 1318],
    step: 0.11,
    length: 0.35,
    gain: 0.16,
    wave: 'triangle',
  },
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
    // 화면을 한 번도 누르지 않은 기기에서는 브라우저가 소리를 멈춰 둔다. 누른 뒤에는 다시 켠다.
    if (context.state === 'suspended') void context.resume();
    const shape = SOUNDS[effect];
    shape.notes.forEach((frequency, index) => {
      const start = context.currentTime + index * shape.step;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = shape.wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(shape.gain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + shape.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + shape.length + 0.03);
    });
  } catch {
    // 소리를 낼 수 없는 기기에서는 효과음을 생략한다.
  }
}
