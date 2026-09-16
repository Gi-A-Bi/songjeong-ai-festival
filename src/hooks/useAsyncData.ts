import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'error'; data?: undefined; error: unknown }
  | { status: 'success'; data: T; error?: undefined };

interface Settled<T> {
  source: () => Promise<T>;
  version: number;
  state: AsyncState<T>;
}

/**
 * 비동기 데이터를 불러온다. load는 useCallback으로 고정해서 넘긴다.
 * reload 중에는 이전 데이터를 유지해 화면이 깜빡이지 않는다.
 */
export function useAsyncData<T>(load: () => Promise<T>) {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active) setSettled({ source: load, version, state: { status: 'success', data } });
      },
      (error: unknown) => {
        if (active) setSettled({ source: load, version, state: { status: 'error', error } });
      },
    );
    return () => {
      active = false;
    };
  }, [load, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  let state: AsyncState<T> = { status: 'loading' };
  let refreshing = false;
  if (settled && settled.source === load) {
    if (settled.version === version) {
      state = settled.state;
    } else if (settled.state.status === 'success') {
      state = settled.state;
      refreshing = true;
    }
  }

  return { ...state, refreshing, reload };
}
