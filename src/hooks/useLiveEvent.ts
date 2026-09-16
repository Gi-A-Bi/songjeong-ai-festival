import { useCallback, useEffect, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';
import type { FestivalEvent } from '../domain/types';
import type { AsyncState } from './useAsyncData';

interface Snapshot {
  key: string;
  state: AsyncState<FestivalEvent>;
}

/** 작은 행사 상태 문서를 실시간 구독한다. */
export function useLiveEvent(eventId: string) {
  const repository = useRepository();
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const key = `${eventId}#${attempt}`;

  useEffect(
    () =>
      repository.subscribeEvent(
        eventId,
        (event) => setSnapshot({ key, state: { status: 'success', data: event } }),
        (error) => setSnapshot({ key, state: { status: 'error', error } }),
      ),
    [repository, eventId, key],
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const state: AsyncState<FestivalEvent> =
    snapshot && snapshot.key === key ? snapshot.state : { status: 'loading' };

  return { ...state, retry };
}
