import type { ImgHTMLAttributes } from 'react';
import { assets, type AssetKey } from '../assets/manifest';

interface AssetImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt' | 'width' | 'height'
> {
  asset: AssetKey;
  /** 장식 이미지면 빈 대체 텍스트를 쓴다. */
  decorative?: boolean;
  alt?: string;
}

/** 이미지 경로와 기본 대체 텍스트는 asset manifest에서 가져온다. */
export function AssetImage({
  asset,
  decorative = false,
  alt,
  loading = 'lazy',
  decoding = 'async',
  ...rest
}: AssetImageProps) {
  const info = assets[asset];
  return (
    <img
      src={info.src}
      alt={decorative ? '' : (alt ?? info.alt)}
      width={info.width}
      height={info.height}
      loading={loading}
      decoding={decoding}
      {...rest}
    />
  );
}
