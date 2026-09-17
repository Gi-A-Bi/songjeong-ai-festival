import { useEffect, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';
import type { Grade, RoundNo } from '../domain/types';

/**
 * 부스 화면용: 이 미션·학년·라운드의 제출이 바뀔 때마다 달라지는 값. 처음에는 0이다.
 * 구독이 붙은 직후에도 한 번 값을 바꿔, 화면을 처음 읽은 뒤 구독이 붙기까지의 틈에
 * 들어온 제출을 놓치지 않는다(이때부터는 구독 캐시로 그리므로 제출을 다시 읽지 않는다).
 */
export function useStationLive(
  eventId: string,
  missionId: string,
  grade: Grade | null,
  roundNo: RoundNo,
): number {
  const repository = useRepository();
  const key = grade === null ? '' : `${eventId}|${missionId}|${grade}|${roundNo}`;
  const [snapshot, setSnapshot] = useState<{ key: string; revision: number } | null>(null);

  useEffect(() => {
    if (grade === null) return undefined;
    let count = 0;
    return repository.subscribeStationSubmissions(
      eventId,
      missionId,
      grade,
      roundNo,
      () => {
        count += 1;
        setSnapshot({ key, revision: count });
      },
      // 구독이 끊겨도 화면은 마지막으로 읽은 내용을 유지하고, 새로고침 버튼으로 다시 읽을 수 있다.
      () => undefined,
    );
  }, [repository, eventId, missionId, grade, roundNo, key]);

  return snapshot && snapshot.key === key ? snapshot.revision : 0;
}
