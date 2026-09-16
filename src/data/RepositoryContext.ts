import { createContext, useContext } from 'react';
import type { DevTools, EventRepository } from './EventRepository';

export interface RepositoryContextValue {
  repository: EventRepository;
  devTools: DevTools | null;
}

export const RepositoryContext = createContext<RepositoryContextValue | null>(null);

function useRepositoryContext(): RepositoryContextValue {
  const value = useContext(RepositoryContext);
  if (!value) throw new Error('RepositoryContext.Provider 안에서만 사용할 수 있습니다.');
  return value;
}

/** 화면은 이 훅으로만 데이터에 접근한다. mock 데이터 파일을 직접 import하지 않는다. */
export function useRepository(): EventRepository {
  return useRepositoryContext().repository;
}

/** mock 모드에서만 제공되는 개발용 도구. firebase 모드에서는 null */
export function useDevTools(): DevTools | null {
  return useRepositoryContext().devTools;
}
