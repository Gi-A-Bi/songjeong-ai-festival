import { ICON_PATHS, type IconName } from './icons';
import './Icon.css';

interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** 아이콘만으로 의미를 전달할 때만 넣는다. 보통은 옆의 한국어 문구가 이름이 된다. */
  label?: string;
}

export function Icon({ name, size = 'md', className, label }: IconProps) {
  return (
    <svg
      className={['icon', `icon--${size}`, className].filter(Boolean).join(' ')}
      viewBox="0 -960 960 960"
      fill="currentColor"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
