import { defineConfig } from 'vitest/config';

/**
 * 보안 규칙 테스트 전용 설정.
 * Firestore 에뮬레이터가 필요하므로 `npm run test:rules`로만 실행한다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.rules.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
