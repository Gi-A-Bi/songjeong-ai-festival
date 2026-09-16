import { useCallback, useRef, useState } from 'react';

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * 저장·제출 같은 동작을 실행한다.
 * 진행 중에는 다시 실행되지 않아 버튼 연타로 중복 요청이 생기지 않는다.
 */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const pending = useRef(false);

  const run = useCallback(
    async (...args: TArgs): Promise<ActionResult<TResult> | null> => {
      if (pending.current) return null;
      pending.current = true;
      setStatus('pending');
      setError(null);
      try {
        const value = await action(...args);
        setStatus('success');
        return { ok: true, value };
      } catch (caught) {
        setStatus('error');
        setError(caught);
        return { ok: false, error: caught };
      } finally {
        pending.current = false;
      }
    },
    [action],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, isPending: status === 'pending', run, reset };
}
