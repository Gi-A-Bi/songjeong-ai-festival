import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../../config';
import { isRepositoryError } from '../errors';
import { toClassId, toTeamId } from './keys';
import { MockEventRepository } from './MockEventRepository';

const EVENT = DEFAULT_EVENT_ID;

describe('MockEventRepository 기기 잠금과 해제', () => {
  let repository: MockEventRepository;

  beforeEach(() => {
    repository = new MockEventRepository({ now: () => 9_000_000 });
  });

  it('처음 입장한 팀에 기기가 묶이고, 다른 팀으로는 입장할 수 없다', async () => {
    const mine = toTeamId(4, 2, 3);
    expect((await repository.getMyDevice(EVENT)).team).toBeNull();

    await repository.joinTeam(EVENT, mine);
    // 같은 팀으로 다시 입장하는 것은 괜찮다(새로고침·QR 재스캔).
    await expect(repository.joinTeam(EVENT, mine)).resolves.toMatchObject({ teamId: mine });
    await expect(repository.joinTeam(EVENT, toTeamId(4, 2, 4))).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'device-locked'),
    );

    const device = await repository.getMyDevice(EVENT);
    expect(device.team?.id).toBe(mine);
    expect(device.code).toMatch(/^[0-9A-Z]{4}$/);
  });

  it('교사가 잠금을 풀면 그 기기는 다른 팀으로 다시 입장할 수 있고 제출 기록은 남는다', async () => {
    const wrong = toTeamId(4, 2, 4);
    const right = toTeamId(4, 2, 3);
    await repository.joinTeam(EVENT, wrong);
    const mine = await repository.getMyDevice(EVENT);

    await repository.signInTeacher();
    const before = await repository.listClassDevices(EVENT, toClassId(4, 2));
    // 샘플: 팀마다 기기 한 대 + 방금 입장한 이 기기
    expect(before).toHaveLength(6);
    expect(before.map((device) => device.teamId)).toEqual(
      [...before.map((device) => device.teamId)].sort(),
    );
    const target = before.find((device) => device.code === mine.code);
    expect(target?.teamId).toBe(wrong);
    if (!target) throw new Error('이 기기가 목록에 없어요');

    const submissions = await repository.listTeamSubmissions(EVENT, wrong);
    await repository.unlockDevice(EVENT, target.id);
    // 이미 풀린 기기를 다시 풀어도 오류가 아니다.
    await expect(repository.unlockDevice(EVENT, target.id)).resolves.toBeUndefined();

    expect(await repository.listClassDevices(EVENT, toClassId(4, 2))).toHaveLength(5);
    expect(await repository.listTeamSubmissions(EVENT, wrong)).toEqual(submissions);
    expect((await repository.getMyDevice(EVENT)).team).toBeNull();
    expect(await repository.getMyTeam(EVENT)).toBeNull();
    await expect(repository.joinTeam(EVENT, right)).resolves.toMatchObject({ teamId: right });
  });

  it('기기 목록과 잠금 해제는 교사만 할 수 있다', async () => {
    await expect(repository.listClassDevices(EVENT, toClassId(4, 2))).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
    await expect(repository.unlockDevice(EVENT, 'any')).rejects.toSatisfy((error) =>
      isRepositoryError(error, 'not-allowed'),
    );
  });
});
