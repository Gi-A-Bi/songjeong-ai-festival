import { describe, expect, it } from 'vitest';
import { compressDrawing, type EncodeDrawing } from './drawing';

const KB = 1024;

/** 품질·배율 순서대로 정해 둔 크기의 결과를 돌려주는 가짜 인코더 */
function fakeEncoder(sizes: (number | null)[]) {
  const calls: { scale: number; quality: number }[] = [];
  const encode: EncodeDrawing = async (_canvas, scale, quality) => {
    const size = sizes[calls.length];
    calls.push({ scale, quality });
    if (size === null || size === undefined) return null;
    return {
      blob: new Blob([new Uint8Array(size)], { type: 'image/webp' }),
      width: 960 * scale,
      height: 540 * scale,
    };
  };
  return { encode, calls };
}

const canvas = {} as HTMLCanvasElement;

describe('그림 압축', () => {
  it('처음 품질 0.65로 300KB 이하면 그대로 쓴다', async () => {
    const { encode, calls } = fakeEncoder([120 * KB]);
    const result = await compressDrawing(canvas, encode);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ scale: 1, quality: 0.65 }]);
  });

  it('300KB를 넘으면 품질을 낮춰 다시 압축한다', async () => {
    const { encode, calls } = fakeEncoder([420 * KB, 310 * KB, 280 * KB]);
    const result = await compressDrawing(canvas, encode);
    expect(result.ok && result.drawing.blob.size).toBe(280 * KB);
    expect(calls.map((call) => call.quality)).toEqual([0.65, 0.55, 0.45]);
  });

  it('끝까지 300KB를 넘어도 가장 작은 결과가 350KB 이하면 쓴다', async () => {
    const { encode } = fakeEncoder([500, 480, 460, 440, 345, 360].map((size) => size * KB));
    const result = await compressDrawing(canvas, encode);
    expect(result.ok && result.drawing.blob.size).toBe(345 * KB);
  });

  it('350KB를 넘으면 제출하지 않는다', async () => {
    const { encode } = fakeEncoder([500, 490, 480, 470, 460, 400].map((size) => size * KB));
    const result = await compressDrawing(canvas, encode);
    expect(result).toEqual({ ok: false, reason: 'too-large', byteSize: 400 * KB });
  });

  it('이미지를 만들지 못하면 알려 준다', async () => {
    const { encode } = fakeEncoder([null, null, null, null, null, null]);
    expect(await compressDrawing(canvas, encode)).toEqual({
      ok: false,
      reason: 'unsupported',
      byteSize: null,
    });
  });
});
