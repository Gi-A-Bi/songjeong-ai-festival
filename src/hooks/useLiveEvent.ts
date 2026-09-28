import { useCallback, useEffect, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';
import type { FestivalEvent } from '../domain/types';
import type { AsyncState } from './useAsyncData';

interface Snapshot {
  key: string;
  state: AsyncState<FestivalEvent>;
}

/**
 * 작은 행사 상태 문서를 실시간 구독한다.
 * teamId를 주면 그 팀이 보는 상태(지금 가야 하는 부스의 단계와 게임 종료 시각)를 받는다.
 */
export function useLiveEvent(eventId: string, teamId?: string) {
  const repository = useRepository();
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const key = `${eventId}#${teamId ?? ''}#${attempt}`;

  useEffect(() => {
    const onChange = (event: FestivalEvent) =>
      setSnapshot({ key, state: { status: 'success', data: event } });
    const onError = (error: unknown) => setSnapshot({ key, state: { status: 'error', error } });
    return teamId
      ? repository.subscribeTeamEvent(eventId, teamId, onChange, onError)
      : repository.subscribeEvent(eventId, onChange, onError);
  }, [repository, eventId, teamId, key]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const state: AsyncState<FestivalEvent> =
    snapshot && snapshot.key === key ? snapshot.state : { status: 'loading' };

  return { ...state, retry };
}
