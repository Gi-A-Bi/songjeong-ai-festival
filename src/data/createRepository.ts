import type { DataMode } from './EventRepository';
import { MockEventRepository } from './mock/MockEventRepository';
import type { RepositoryContextValue } from './RepositoryContext';

export function resolveDataMode(raw: string | undefined): DataMode {
  const value = raw?.trim();
  if (!value || value === 'mock') return 'mock';
  if (value === 'firebase') return 'firebase';
  throw new Error(`알 수 없는 VITE_DATA_MODE 값입니다: ${value} (mock 또는 firebase)`);
}

/**
 * VITE_DATA_MODE에 맞는 저장소를 만든다.
 * Firebase SDK는 firebase 모드일 때만 내려받도록 따로 불러온다(학교 네트워크 배려).
 */
export async function createRepository(
  mode: DataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE),
): Promise<RepositoryContextValue> {
  if (mode === 'firebase') {
    const { FirestoreEventRepository } = await import('./firebase/FirestoreEventRepository');
    // 개발 도구(샘플 초기화, 실패 흉내)는 mock에서만 제공한다.
    return { repository: new FirestoreEventRepository(), devTools: null };
  }
  const repository = new MockEventRepository({ latencyMs: 300 });
  return { repository, devTools: repository };
}
