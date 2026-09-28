import type { Grade } from './types';

/**
 * 한 학년에 남아 있는 연습·진행 기록의 수.
 * 연습(리허설)을 마친 뒤 행사 전에 총괄 운영자가 지운다.
 */
export interface RehearsalRecordCounts {
  /** 팀이 낸 제출(그림 파일 포함) */
  submissions: number;
  /** 확정한 순위 */
  results: number;
  cardAwards: number;
  /** 교실 QR 입장 기록 */
  checkIns: number;
  /** 부스가 열거나 진행한 라운드 */
  boothRounds: number;
  /** 최종 미션을 시작한 학급 */
  finalClasses: number;
  /** 팀에 묶인 기기 */
  devices: number;
}

export interface RehearsalSummary {
  grade: Grade;
  counts: RehearsalRecordCounts;
  /** 총괄 운영자가 이 학년의 최종 미션을 열어 둔 상태인지 */
  finalOpened: boolean;
}

export const REHEARSAL_RECORD_KEYS = [
  'submissions',
  'results',
  'cardAwards',
  'checkIns',
  'boothRounds',
  'finalClasses',
  'devices',
] as const satisfies readonly (keyof RehearsalRecordCounts)[];

export const REHEARSAL_RECORD_LABELS: Record<
  keyof RehearsalRecordCounts,
  { label: string; unit: string }
> = {
  submissions: { label: '제출', unit: '건' },
  results: { label: '순위', unit: '건' },
  cardAwards: { label: '카드 보상', unit: '건' },
  checkIns: { label: '교실 입장 기록', unit: '건' },
  boothRounds: { label: '부스 라운드', unit: '건' },
  finalClasses: { label: '최종 미션 학급 기록', unit: '건' },
  devices: { label: '팀에 묶인 기기', unit: '대' },
};

export const EMPTY_REHEARSAL_COUNTS: RehearsalRecordCounts = {
  submissions: 0,
  results: 0,
  cardAwards: 0,
  checkIns: 0,
  boothRounds: 0,
  finalClasses: 0,
  devices: 0,
};

export function countRehearsalRecords(counts: RehearsalRecordCounts): number {
  return REHEARSAL_RECORD_KEYS.reduce((sum, key) => sum + counts[key], 0);
}

/** 지울 것이 남아 있는지. 기록이 없어도 최종 미션을 열어 두었으면 되돌릴 것이 있다. */
export function hasRehearsalRecords(summary: RehearsalSummary): boolean {
  return summary.finalOpened || countRehearsalRecords(summary.counts) > 0;
}

/** 실수로 지우지 않도록 확인 창에 직접 적게 하는 말 */
export function getResetConfirmPhrase(grade: Grade): string {
  return `${grade}학년`;
}

/** 확인 창에 적은 말이 맞는지. 앞뒤와 사이의 빈칸은 봐준다. */
export function isResetConfirmed(grade: Grade, typed: string): boolean {
  return typed.replace(/\s+/g, '') === getResetConfirmPhrase(grade);
}
