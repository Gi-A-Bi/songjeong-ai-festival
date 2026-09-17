import { useMemo } from 'react';
import { createQrShape } from '../lib/qr';

interface QrCodeProps {
  /** QR에 담을 주소 */
  value: string;
  /** 화면 낭독기와 테스트가 읽는 이름. 예: "4학년 2반 3팀 입장 QR" */
  label: string;
  className?: string;
}

/** 인쇄해도 흐려지지 않게 SVG로 그리는 QR 코드. 색은 인식률을 위해 항상 검정·흰색이다. */
export function QrCode({ value, label, className }: QrCodeProps) {
  const shape = useMemo(() => createQrShape(value), [value]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${shape.size} ${shape.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr-value={value}
    >
      <rect width={shape.size} height={shape.size} fill="#ffffff" />
      <path d={shape.path} fill="#000000" />
    </svg>
  );
}
