import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// 여러 화면 테스트가 함께 돌면 느린 PC에서 기본 1초를 넘길 수 있어 기다리는 시간을 늘린다.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
