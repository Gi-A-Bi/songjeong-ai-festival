import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);
}

describe('ZIP 작성기', () => {
  it('CRC-32를 표준 값으로 계산한다', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('한글 파일 이름과 내용을 그대로 담고 끝 레코드에 파일 수를 적는다', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    const zip = createZip([
      { name: '4학년-2반-3팀_1라운드.webp', data: first, modifiedAt: new Date(2026, 8, 16) },
      { name: 'b.png', data: second, modifiedAt: new Date(2026, 8, 16) },
    ]);
    const firstName = new TextEncoder().encode('4학년-2반-3팀_1라운드.webp');

    expect(readUint32(zip, 0)).toBe(0x04034b50);
    expect(readUint16(zip, 6) & 0x0800).toBe(0x0800);
    expect(readUint32(zip, 14)).toBe(crc32(first));
    expect(readUint16(zip, 26)).toBe(firstName.length);
    expect(new TextDecoder().decode(zip.subarray(30, 30 + firstName.length))).toBe(
      '4학년-2반-3팀_1라운드.webp',
    );
    expect(Array.from(zip.subarray(30 + firstName.length, 33 + firstName.length))).toEqual([
      1, 2, 3,
    ]);

    const end = zip.length - 22;
    expect(readUint32(zip, end)).toBe(0x06054b50);
    expect(readUint16(zip, end + 10)).toBe(2);
    const centralOffset = readUint32(zip, end + 16);
    expect(readUint32(zip, centralOffset)).toBe(0x02014b50);
  });
});
