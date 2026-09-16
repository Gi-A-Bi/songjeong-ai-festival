import { useCallback, useSyncExternalStore } from 'react';

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** 브라우저의 온라인·오프라인 상태 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

function subscribeFullscreen(callback: () => void) {
  document.addEventListener('fullscreenchange', callback);
  return () => document.removeEventListener('fullscreenchange', callback);
}

/** 전체 화면 상태와 전환 함수 */
export function useFullscreen() {
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // 기기가 전체 화면을 막는 경우에는 조용히 무시한다.
    }
  }, []);

  return { isFullscreen, supported, toggle };
}
