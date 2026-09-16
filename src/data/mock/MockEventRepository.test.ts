import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import { MockEventRepository } from './MockEventRepository';
import { DEMO_TEAM_ID } from './seed';

const EVENT = DEFAULT_EVENT_ID;

describe('MockEventRepository', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => 1_000_000, random: () => 0 });
  });

  it('3~6학년 학급 수와 학급당 5팀을 만든다', async () => {
    const counts = await Promise.all(
      ([3, 4, 5, 6] as const).map(async (grade) => ({
        classes: (await repository.listClasses(EVENT, grade)).length,
        teams: (await repository.listTeams(EVENT, grade)).length,
      })),
    );
    expect(counts).toEqual([
      { classes: 4, teams: 20 },
      { classes: 5, teams: 25 },
      { classes: 6, teams: 30 },
      { classes: 5, teams: 25 },
    ]);
  });

  it('샘플 팀은 4학년 2반 3팀, 카드 2장과 미사용 뽑기권 3장으로 시작한다', async () => {
    const tickets = await repository.listTeamTickets(EVENT, DEMO_TEAM_ID);
    expect(tickets.filter((item) => item.claimed)).toHaveLength(2);
    const unclaimed = tickets.filter((item) => !item.claimed);
    expect(unclaimed).toHaveLength(3);
    expect(unclaimed.every((item) => item.cardType === null)).toBe(true);
  });

  it('사용한 뽑기권으로 다시 카드를 뽑을 수 없다', async () => {
    const [first] = (await repository.listTeamTickets(EVENT, DEMO_TEAM_ID)).filter(
      (item) => !item.claimed,
    );
    const cardType = await repository.claimTicket(EVENT, DEMO_TEAM_ID, first.id);
    expect(cardType).toBeTruthy();
    await expect(repository.claimTicket(EVENT, DEMO_TEAM_ID, first.id)).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'already-claimed'),
    );
  });

  it('순위 확정 시 1위 3장, 2위 2장, 나머지 1장을 만들고 다시 눌러도 늘지 않는다', async () => {
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    expect(participants).toHaveLength(5);
    const input = {
      eventId: EVENT,
      missionId: 'golden-bell',
      grade: 4 as const,
      roundNo: 2 as const,
      requestId: 'req-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 500 - index * 100,
        rank: index + 1,
      })),
    };
    const outcome = await repository.finalizeRanking(input);
    expect(participants.map((participant) => outcome.ticketsByTeam[participant.team.id])).toEqual([
      3, 2, 1, 1, 1,
    ]);
    const again = await repository.finalizeRanking({ ...input, requestId: 'req-2' });
    expect(again.alreadyFinalized).toBe(true);
    expect(Object.values(again.ticketsByTeam).reduce((sum, count) => sum + count, 0)).toBe(8);
  });

  it('보유량보다 많은 교환은 막고 교환 후 수량을 갱신한다', async () => {
    await repository.signInTeacher();
    const rows = await repository.listClassCardRows(EVENT, 4);
    const [from, to] = rows;
    const owned = from.counts.thinking;
    const base = {
      eventId: EVENT,
      fromClassId: from.classInfo.id,
      toClassId: to.classInfo.id,
      cardType: 'thinking' as const,
    };

    await expect(
      repository.createExchange({ ...base, requestId: 'ex-over', quantity: owned + 1 }),
    ).rejects.toSatisfy((error) => isRepositoryError(error, 'insufficient-cards'));

    if (owned > 0) {
      await repository.createExchange({ ...base, requestId: 'ex-ok', quantity: 1 });
      await repository.createExchange({ ...base, requestId: 'ex-ok', quantity: 1 });
      const after = await repository.listClassCardRows(EVENT, 4);
      expect(after[0].counts.thinking).toBe(owned - 1);
      expect(after[1].counts.thinking).toBe(to.counts.thinking + 1);
      expect(await repository.listExchanges(EVENT, 4)).toHaveLength(1);
    }
  });

  it('같은 requestId로 다시 제출해도 제출이 중복되지 않는다', async () => {
    const input = {
      eventId: EVENT,
      missionId: 'ozobot',
      teamId: DEMO_TEAM_ID,
      answer: { type: 'ozobot' as const, ready: true as const },
      requestId: 'submit-1',
    };
    const first = await repository.saveSubmission(input);
    const retry = await repository.saveSubmission(input);
    expect(retry.id).toBe(first.id);
    await expect(repository.saveSubmission({ ...input, requestId: 'submit-2' })).rejects.toSatisfy(
      (error) => isRepositoryError(error, 'not-allowed'),
    );
  });
});
