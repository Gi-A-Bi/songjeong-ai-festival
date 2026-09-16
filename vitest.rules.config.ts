import { defineConfig } from 'vitest/config';

/**
 * 에뮬레이터가 필요한 테스트 전용 설정(보안 규칙, Firestore 저장소).
 * `npm run test:emulator`로 실행한다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      VITE_DATA_MODE: 'firebase',
      VITE_USE_FIREBASE_EMULATORS: '1',
      VITE_FIREBASE_PROJECT_ID: 'demo-songjeong',
    },
  },
});
