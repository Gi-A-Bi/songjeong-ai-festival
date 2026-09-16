import { useEffect, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';
import type { Grade, RoundNo } from '../domain/types';

interface MissionStateTarget {
  missionId: string;
  grade: Grade;
  roundNo: RoundNo;
}

/**
 * 미션 상태 문서(정답 공개, 순위 확정, 재제출 허용)를 실시간 구독하고,
 * 바뀔 때마다 달라지는 값(revision)을 돌려준다. 첫 값은 빈 문자열이다.
 */
export function useMissionLiveState(eventId: string, target: MissionStateTarget | null) {
  const repository = useRepository();
  const key = target ? `${target.missionId}|${target.grade}|${target.roundNo}` : '';
  const [snapshot, setSnapshot] = useState<{ key: string; revision: string } | null>(null);

  useEffect(() => {
    if (!key) return undefined;
    const [missionId, grade, roundNo] = key.split('|');
    let first = true;
    return repository.subscribeMissionState(
      eventId,
      missionId,
      Number(grade) as Grade,
      Number(roundNo) as RoundNo,
      (state) => {
        // 처음 받은 상태는 방금 읽은 화면과 같으므로 다시 읽지 않는다.
        const revision = first
          ? ''
          : `${state.updatedAt}|${state.answerRevealed}|${state.finalized}`;
        first = false;
        setSnapshot({ key, revision });
      },
      // 구독이 끊겨도 미션은 계속할 수 있다. 다시 들어오면 새로 읽는다.
      () => undefined,
    );
  }, [repository, eventId, key]);

  return snapshot && snapshot.key === key ? snapshot.revision : '';
}
