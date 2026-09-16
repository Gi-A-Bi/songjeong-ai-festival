import type { DataMode } from './EventRepository';
import { MockEventRepository } from './mock/MockEventRepository';
import type { RepositoryContextValue } from './RepositoryContext';

export function resolveDataMode(raw: string | undefined): DataMode {
  const value = raw?.trim();
  if (!value || value === 'mock') return 'mock';
  if (value === 'firebase') return 'firebase';
  throw new Error(`알 수 없는 VITE_DATA_MODE 값입니다: ${value} (mock 또는 firebase)`);
}

/** VITE_DATA_MODE에 맞는 저장소를 만든다. 1단계는 mock만 지원한다. */
export function createRepository(
  mode: DataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE),
): RepositoryContextValue {
  if (mode === 'firebase') {
    throw new Error(
      'firebase 데이터 모드는 2단계에서 추가됩니다. .env의 VITE_DATA_MODE를 비우거나 mock으로 설정하세요.',
    );
  }
  const repository = new MockEventRepository({ latencyMs: 300 });
  return { repository, devTools: repository };
}
