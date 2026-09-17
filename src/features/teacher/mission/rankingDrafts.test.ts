import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../../config';
import { toTeamId } from '../../../data/mock/keys';
import { MockEventRepository } from '../../../data/mock/MockEventRepository';
import { initialDrafts, mergeDrafts, NO_DRAFT_EDITS, submissionSignature } from './rankingDrafts';

const EVENT = DEFAULT_EVENT_ID;
// 샘플 데이터: 4학년 2라운드 골든벨은 5팀이 오고, 2반·4반 5팀은 아직 제출하지 않았다.
const LATE_TEAM = toTeamId(4, 2, 5);
const TOP_TEAM = toTeamId(4, 5, 5);

describe('순위표 입력값 맞추기', () => {
  let repository: MockEventRepository;
  const participantsNow = () => repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
  const submitLate = () =>
    repository.saveSubmission({
      eventId: EVENT,
      missionId: 'golden-bell',
      teamId: LATE_TEAM,
      // 샘플 문제 q1·q2의 정답 → 자동 점수 200점
      answer: { type: 'golden_bell', selections: { q1: 1, q2: 2 } },
      requestId: 'late-submit',
    });

  beforeEach(async () => {
    repository = new MockEventRepository();
    await repository.signInTeacher();
  });

  it('새 제출이 들어와도 교사가 고친 점수는 그대로 두고, 새 팀에는 자동 점수를 채운다', async () => {
    const before = await participantsNow();
    const drafts = initialDrafts(before);
    drafts[TOP_TEAM] = { ...drafts[TOP_TEAM], score: '150' };

    await submitLate();
    const merged = mergeDrafts(drafts, await participantsNow(), {
      scoreTeamIds: new Set([TOP_TEAM]),
      ranks: false,
    });

    expect(merged[TOP_TEAM].score).toBe('150');
    expect(merged[LATE_TEAM].score).toBe('200');
    // 순위를 직접 바꾼 적이 없으면 고친 점수까지 넣어 점수 순으로 다시 매긴다.
    expect(merged[LATE_TEAM].rank).toBeLessThan(merged[TOP_TEAM].rank);
    expect(
      Object.values(merged)
        .map((draft) => draft.rank)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('교사가 순위를 직접 바꿨으면 새 제출이 와도 순위를 다시 매기지 않는다', async () => {
    const drafts = initialDrafts(await participantsNow());
    const manualRanks = Object.fromEntries(
      Object.entries(drafts).map(([teamId, draft]) => [teamId, draft.rank]),
    );

    await submitLate();
    const merged = mergeDrafts(drafts, await participantsNow(), {
      scoreTeamIds: new Set(),
      ranks: true,
    });

    for (const [teamId, rank] of Object.entries(manualRanks)) {
      expect(merged[teamId].rank).toBe(rank);
    }
    expect(merged[LATE_TEAM].score).toBe('200');
  });

  it('확정한 순위는 점수 순으로 다시 매기지 않는다', async () => {
    const participants = await participantsNow();
    // 점수와 거꾸로 확정한다(교사가 직접 정한 순위).
    const byScore = initialDrafts(participants);
    await repository.finalizeRanking({
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 2,
      requestId: 'finalize-reversed',
      entries: participants.map((participant) => ({
        teamId: participant.team.id,
        score: Number(byScore[participant.team.id].score),
        rank: 6 - byScore[participant.team.id].rank,
      })),
    });

    const finalized = await participantsNow();
    const merged = mergeDrafts(initialDrafts(participants), finalized, NO_DRAFT_EDITS);
    for (const participant of finalized) {
      expect(merged[participant.team.id].rank).toBe(participant.result?.rank);
    }
  });

  it('제출 요약은 팀이 제출하면 달라지고, 같은 자료를 다시 읽으면 같다', async () => {
    const before = submissionSignature(await participantsNow());
    expect(submissionSignature(await participantsNow())).toBe(before);
    await submitLate();
    expect(submissionSignature(await participantsNow())).not.toBe(before);
  });
});
