import type { CSSProperties, ReactNode } from 'react';
import type { CircleRegion } from '../../../domain/types';

interface HuntRegionMarkerProps {
  region: CircleRegion;
  className?: string;
  children?: ReactNode;
}

/**
 * 그림 위에 정답 영역을 그린다. 그림을 감싼 요소가 position: relative여야 한다.
 * 타원은 가로·세로 반지름을 그림 크기에 대한 비율로, 원은 가로 반지름만으로 그린다.
 */
export function HuntRegionMarker({ region, className, children }: HuntRegionMarkerProps) {
  const style: CSSProperties = {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.r * 200}%`,
  };
  if (region.ry === undefined) style.aspectRatio = '1';
  else style.height = `${region.ry * 200}%`;
  return (
    <span className={['hunt-marker', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </span>
  );
}
