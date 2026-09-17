import { useEffect, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';

/**
 * 저장소가 알려 주는 서버 기준 현재 시각(epoch ms)을 주기적으로 갱신한다.
 * 남은 시간·경과 시간처럼 서버 시각이 기준인 계산은 이 값을 쓴다.
 */
export function useServerNow(intervalMs = 1000): number {
  const repository = useRepository();
  const [now, setNow] = useState(() => repository.serverNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(repository.serverNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [repository, intervalMs]);

  return now;
}
