import { describe, expect, it } from 'vitest';
import { labelPhoto, labelStripHeight } from './photoLabel';

describe('팀 이름표', () => {
  it('이름표 띠는 사진 높이의 8%이고 작은 사진에서도 56px은 된다', () => {
    expect(labelStripHeight(960)).toBe(77);
    expect(labelStripHeight(1280)).toBe(102);
    expect(labelStripHeight(300)).toBe(56);
  });

  it('사진을 읽지 못하면 null을 돌려줘 원래 사진을 쓰게 한다', async () => {
    // 테스트 환경에는 Canvas가 없다.
    expect(await labelPhoto(new Uint8Array(), 'image/webp', '4학년 1반 2팀')).toBeNull();
  });
});
