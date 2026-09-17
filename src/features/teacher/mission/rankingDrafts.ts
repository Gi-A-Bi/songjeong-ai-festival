import type { MissionParticipant } from '../../../data/EventRepository';
import { rankByScore } from '../../../domain/rewards';

/** 순위표 한 줄의 입력값 */
export interface RowDraft {
  score: string;
  rank: number;
}

export type RankingDrafts = Record<string, RowDraft>;

/** 교사가 직접 손댄 입력. 제출이 새로 들어와 목록을 다시 그려도 이 값은 지우지 않는다. */
export interface DraftEdits {
  /** 점수를 직접 고친 팀 */
  scoreTeamIds: ReadonlySet<string>;
  /** 순위를 화살표로 직접 바꿨는지 */
  ranks: boolean;
}

export const NO_DRAFT_EDITS: DraftEdits = { scoreTeamIds: new Set(), ranks: false };

function toScore(value: string): number {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

/** 저장된 순위가 있으면 그 값, 없으면 자동 점수와 제출 시각으로 정한 순위 */
export function initialDrafts(participants: readonly MissionParticipant[]): RankingDrafts {
  const ranked = rankByScore(
    participants.map((participant) => ({
      teamId: participant.team.id,
      score: participant.result?.score ?? participant.submission?.score ?? 0,
      submittedAt: participant.submission?.submittedAt ?? null,
    })),
  );
  return Object.fromEntries(
    ranked.map((entry) => {
      const participant = participants.find((item) => item.team.id === entry.teamId);
      return [
        entry.teamId,
        { score: String(entry.score), rank: participant?.result?.rank ?? entry.rank },
      ];
    }),
  );
}

/**
 * 참가 팀 자료가 새로 들어왔을 때(학생 제출, 재제출 허용) 입력값을 맞춘다.
 * 교사가 고친 점수는 그대로 두고, 나머지는 새 자료의 점수를 쓴다.
 * 순위는 교사가 직접 바꾼 적이 없을 때만 점수 순으로 다시 매긴다.
 */
export function mergeDrafts(
  previous: RankingDrafts,
  participants: readonly MissionParticipant[],
  edits: DraftEdits,
): RankingDrafts {
  const fresh = initialDrafts(participants);
  const scores = Object.fromEntries(
    participants.map((participant) => {
      const teamId = participant.team.id;
      const kept = edits.scoreTeamIds.has(teamId) ? previous[teamId]?.score : undefined;
      return [teamId, kept ?? fresh[teamId].score];
    }),
  );

  const keepRanks =
    edits.ranks && participants.every((participant) => previous[participant.team.id] !== undefined);
  // 이미 확정한 순위는 교사가 정한 값이므로 점수로 다시 매기지 않는다.
  const finalized = participants.some((participant) => participant.result !== null);
  if (keepRanks || finalized) {
    return Object.fromEntries(
      participants.map((participant) => {
        const teamId = participant.team.id;
        const rank = keepRanks ? previous[teamId].rank : fresh[teamId].rank;
        return [teamId, { score: scores[teamId], rank }];
      }),
    );
  }

  const ranked = rankByScore(
    participants.map((participant) => ({
      teamId: participant.team.id,
      score: toScore(scores[participant.team.id]),
      submittedAt: participant.submission?.submittedAt ?? null,
    })),
  );
  return Object.fromEntries(
    ranked.map((entry) => [entry.teamId, { score: scores[entry.teamId], rank: entry.rank }]),
  );
}

/**
 * 화면에 보이는 제출 상태를 한 줄로 요약한다. 순위 확정 직전에 서버에서 다시 읽은 값과 비교해
 * 화면이 아직 받지 못한 제출이 있는지 알아낸다.
 */
export function submissionSignature(participants: readonly MissionParticipant[]): string {
  return participants
    .map(
      ({ team, submission }) =>
        `${team.id}:${submission?.status ?? '-'}:${submission?.submittedAt ?? 0}`,
    )
    .sort()
    .join('|');
}
