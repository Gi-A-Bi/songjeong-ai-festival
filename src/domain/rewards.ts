/** 미션 순위에 따른 카드 뽑기권 수: 1위 3장, 2위 2장, 3위 이하 1장 */
export function getTicketCountForRank(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`순위는 1 이상의 정수여야 합니다: ${rank}`);
  }
  if (rank === 1) return 3;
  if (rank === 2) return 2;
  return 1;
}

export interface RankEntry {
  teamId: string;
  score: number;
  /** 동점 처리용 제출 시각(epoch ms). 빠를수록 앞선다. */
  submittedAt: number | null;
}

/** 점수 내림차순, 동점이면 제출 시각이 빠른 팀을 앞에 두고 1부터 순위를 매긴다. */
export function rankByScore<T extends RankEntry>(entries: readonly T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.submittedAt ?? Number.POSITIVE_INFINITY;
    const bTime = b.submittedAt ?? Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
