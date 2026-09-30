import { formatMissionRoom } from './missionRoom';
import type { Mission } from './types';

/** 미션 교실 인증코드는 숫자 네 자리다. 학생이 미션 화면에서 넣고 들어온다. */
export const STATION_CODE_LENGTH = 4;

/** 교실별 인증코드. 아직 정하지 않은 교실은 code가 null이다. */
export interface StationCode {
  missionId: string;
  code: string | null;
  updatedAt: number | null;
}

/** 입력한 글에서 숫자만 남긴다(붙여넣기, 전각 숫자, 띄어쓰기 대비). */
export function normalizeStationCode(input: string): string {
  return input.normalize('NFKC').replace(/\D/gu, '').slice(0, STATION_CODE_LENGTH);
}

export function isValidStationCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && new RegExp(`^\\d{${STATION_CODE_LENGTH}}$`, 'u').test(code);
}

const MAX_RANDOM_TRIES = 50;

function randomDigits(random: () => number): string {
  const value = Math.min(Math.max(random(), 0), 0.999999);
  return String(Math.floor(value * 10 ** STATION_CODE_LENGTH)).padStart(STATION_CODE_LENGTH, '0');
}

/** 0000처럼 외우기 쉬운 코드는 피하고 네 자리 숫자를 무작위로 만든다. */
export function createRandomStationCode(random: () => number = Math.random): string {
  let code = randomDigits(random);
  for (let tries = 0; tries < MAX_RANDOM_TRIES; tries += 1) {
    if (!/^(\d)\1+$/u.test(code) && code !== '1234') return code;
    code = randomDigits(random);
  }
  // 난수가 고장 나도 멈추지 않게 마지막 값을 그대로 쓴다.
  return code;
}

/** 다섯 교실의 코드를 한 번에 만든다. 서로 다른 코드가 나오게 한다. */
export function createRandomStationCodes(
  missionIds: readonly string[],
  random: () => number = Math.random,
): Record<string, string> {
  const used = new Set<string>();
  const codes: Record<string, string> = {};
  for (const missionId of missionIds) {
    let code = createRandomStationCode(random);
    for (let tries = 0; used.has(code) && tries < MAX_RANDOM_TRIES; tries += 1) {
      code = createRandomStationCode(random);
    }
    used.add(code);
    codes[missionId] = code;
  }
  return codes;
}

/** 저장 전에 코드 묶음을 검사한다. 문제가 없으면 null */
export function getStationCodesError(
  codes: Record<string, string>,
  missions: readonly Pick<Mission, 'id' | 'room'>[],
): string | null {
  const seen = new Map<string, string>();
  for (const mission of missions) {
    const code = codes[mission.id];
    const room = formatMissionRoom(mission.room, null);
    if (!isValidStationCode(code)) {
      return `${room}의 인증코드를 숫자 ${STATION_CODE_LENGTH}자리로 적어 주세요.`;
    }
    const other = seen.get(code);
    if (other) return `${other}과(와) ${room}의 인증코드가 같아요. 다르게 정해 주세요.`;
    seen.set(code, room);
  }
  return null;
}

/** 학생이 넣은 코드가 교실 코드와 같은지 */
export function matchesStationCode(expected: string | null, typed: string): boolean {
  return expected !== null && normalizeStationCode(typed) === expected;
}

/** 연달아 틀리면 잠깐 기다리게 해 마구 눌러 맞히지 못하게 한다. */
export const STATION_CODE_MAX_TRIES = 3;
export const STATION_CODE_COOLDOWN_MS = 10_000;
