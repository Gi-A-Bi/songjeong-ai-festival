import qrcode from 'qrcode-generator';

/** QR 둘레에 꼭 있어야 하는 여백(모듈 4칸). 없으면 카메라가 잘 읽지 못한다. */
const QUIET_ZONE = 4;

export interface QrShape {
  /** 여백을 포함한 한 변의 칸 수(SVG viewBox 크기) */
  size: number;
  /** 검은 칸을 모두 이은 SVG path */
  path: string;
}

/**
 * 글자를 QR 모양으로 바꾼다. 기기 안에서만 계산하며 외부 서비스에 주소를 보내지 않는다.
 * 오류 복원 수준 M은 인쇄물이 조금 구겨지거나 얼룩져도 읽히는 정도다.
 */
export function createQrShape(text: string): QrShape {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const segments: string[] = [];
  for (let row = 0; row < count; row += 1) {
    let start = -1;
    // 가로로 이어진 검은 칸은 한 줄로 묶어 path를 짧게 만든다.
    for (let col = 0; col <= count; col += 1) {
      const dark = col < count && code.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        segments.push(
          `M${start + QUIET_ZONE},${row + QUIET_ZONE}h${col - start}v1h${start - col}z`,
        );
        start = -1;
      }
    }
  }
  return { size: count + QUIET_ZONE * 2, path: segments.join('') };
}
