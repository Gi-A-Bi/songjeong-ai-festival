import { useEffect, useState } from 'react';
import type { EventRepository, Unsubscribe } from '../data/EventRepository';
import { useRepository } from '../data/RepositoryContext';
import type { Grade } from '../domain/types';

type Subscribe = (
  repository: EventRepository,
  eventId: string,
  grade: Grade,
  onChange: (revision: number) => void,
  onError: (error: unknown) => void,
  scope: string | null,
) => Unsubscribe;

/**
 * 학년 단위 실시간 구독을 "바뀔 때마다 달라지는 값(revision)"으로 바꾼다. 첫 값은 0이다.
 * 구독이 끊겨도 화면은 마지막으로 읽은 내용을 유지한다.
 */
function useLiveRevision(
  subscribe: Subscribe,
  eventId: string,
  grade: Grade | null,
  scope: string | null = null,
): number {
  const repository = useRepository();
  const key = grade === null ? '' : `${eventId}|${grade}|${scope ?? ''}`;
  const [snapshot, setSnapshot] = useState<{ key: string; revision: number } | null>(null);

  useEffect(() => {
    if (grade === null) return undefined;
    let first = true;
    return subscribe(
      repository,
      eventId,
      grade,
      (revision) => {
        // 처음 받은 값은 방금 읽은 화면과 같으므로 다시 읽지 않는다.
        const next = first ? 0 : revision;
        first = false;
        setSnapshot({ key, revision: next });
      },
      () => undefined,
      scope,
    );
  }, [subscribe, repository, eventId, grade, key, scope]);

  return snapshot && snapshot.key === key ? snapshot.revision : 0;
}

const subscribeFinal: Subscribe = (repository, eventId, grade, onChange, onError, classId) =>
  repository.subscribeFinal(eventId, grade, onChange, onError, classId ?? undefined);

const subscribeOps: Subscribe = (repository, eventId, grade, onChange, onError) =>
  repository.subscribeOps(eventId, grade, onChange, onError);

/**
 * 학년 최종 미션(세션·학급 상태)의 변화.
 * classId를 주면 세션과 그 학급의 변화만 받는다(다른 반의 진행으로 다시 읽지 않는다).
 */
export function useFinalLive(
  eventId: string,
  grade: Grade | null,
  classId: string | null = null,
): number {
  return useLiveRevision(subscribeFinal, eventId, grade, classId);
}

/** 현재 학년의 팀 이동·부스·카드 상태의 변화 */
export function useOpsLive(eventId: string, grade: Grade | null): number {
  return useLiveRevision(subscribeOps, eventId, grade);
}
