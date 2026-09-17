import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages는 /저장소이름/ 아래에서 서비스된다. 로컬 개발은 기본값 '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 보안 규칙 테스트는 에뮬레이터가 필요해 npm run test:rules로만 실행한다.
    exclude: [...configDefaults.exclude, 'tests/**'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
