import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { createQrShape } from './qr';

const QUIET_ZONE = 4;
const SAMPLE = 'https://songjeong-ai-festival.web.app/join/songjeong-ai-festival-2026/g4-c2-t3';

/** path를 다시 칸 단위 그림으로 바꾼다(M x,y h 너비 v1 h -너비 z 묶음). */
function rasterize(path: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const match of path.matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, width] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let offset = 0; offset < width; offset += 1) grid[y][x + offset] = true;
  }
  return grid;
}

/** 인쇄물을 카메라로 찍은 것처럼 칸 하나를 여러 픽셀로 키운 흑백 그림을 만든다. */
function toImage(grid: boolean[][], scale: number) {
  const width = grid.length * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = grid[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width };
}

describe('createQrShape', () => {
  it('그린 QR을 해독기로 읽으면 넣은 주소가 그대로 나온다', () => {
    const addresses = [
      SAMPLE,
      'https://songjeong-ai-festival.web.app/check-in/songjeong-ai-festival-2026/library-check',
      'http://localhost:5173/join/e/t',
    ];
    for (const address of addresses) {
      const shape = createQrShape(address);
      const image = toImage(rasterize(shape.path, shape.size), 6);
      expect(jsQR(image.data, image.width, image.width)?.data).toBe(address);
    }
  });

  it('라이브러리가 계산한 칸을 행·열이 뒤바뀌지 않게 그대로 그린다', () => {
    const shape = createQrShape(SAMPLE);
    const code = qrcode(0, 'M');
    code.addData(SAMPLE);
    code.make();
    const count = code.getModuleCount();
    expect(shape.size).toBe(count + QUIET_ZONE * 2);

    const grid = rasterize(shape.path, shape.size);
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        expect(grid[row + QUIET_ZONE][col + QUIET_ZONE]).toBe(code.isDark(row, col));
      }
    }
  });

  it('둘레 네 칸은 비워 둔다(카메라 인식용 여백)', () => {
    const shape = createQrShape(SAMPLE);
    const grid = rasterize(shape.path, shape.size);
    const last = shape.size - 1;
    for (let index = 0; index < shape.size; index += 1) {
      for (let margin = 0; margin < QUIET_ZONE; margin += 1) {
        expect(grid[margin][index]).toBe(false);
        expect(grid[last - margin][index]).toBe(false);
        expect(grid[index][margin]).toBe(false);
        expect(grid[index][last - margin]).toBe(false);
      }
    }
  });

  it('세 모서리에 위치 찾기 무늬(7×7)가 있다', () => {
    const shape = createQrShape(SAMPLE);
    const grid = rasterize(shape.path, shape.size);
    const count = shape.size - QUIET_ZONE * 2;
    const finder = (top: number, left: number) => {
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
          const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
          // 바깥 테두리(3)와 가운데 3×3(0~1)은 검정, 그 사이(2)는 흰색
          expect(grid[top + row + QUIET_ZONE][left + col + QUIET_ZONE]).toBe(ring !== 2);
        }
      }
    };
    finder(0, 0);
    finder(0, count - 7);
    finder(count - 7, 0);
  });

  it('주소가 다르면 다른 QR이 나온다', () => {
    expect(createQrShape(SAMPLE).path).not.toBe(createQrShape(`${SAMPLE}x`).path);
  });
});
