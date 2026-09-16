import type { ReactNode } from 'react';
import { useSettings } from '../app/SettingsContext';
import { useFullscreen, useOnlineStatus } from '../hooks/useBrowserState';
import { AssetImage } from './AssetImage';
import { ButtonLink } from './Button';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import './AppHeader.css';

interface AppHeaderProps {
  /** 뒤로 가기 목적지. 없으면 뒤로 가기 버튼을 숨긴다. */
  backTo?: string;
  subtitle?: string;
  variant?: 'student' | 'teacher';
  /** 교사용 탭 같은 추가 메뉴 */
  nav?: ReactNode;
}

export function AppHeader({ backTo, subtitle, variant = 'student', nav }: AppHeaderProps) {
  return (
    <header className={`app-header app-header--${variant}`}>
      <div className="app-header__inner">
        <div className="app-header__start">
          {backTo ? (
            <ButtonLink
              to={backTo}
              variant="secondary"
              icon="arrow_back"
              className="app-header__back"
            >
              뒤로
            </ButtonLink>
          ) : null}
          <div className="app-header__brand">
            <AssetImage asset="schoolLogo" className="app-header__logo" loading="eager" />
            <div className="app-header__titles">
              <span className="app-header__title">
                {variant === 'teacher' ? '송정 AI 페스티벌 운영' : '송정 AI 페스티벌'}
              </span>
              {subtitle ? <span className="app-header__subtitle">{subtitle}</span> : null}
            </div>
          </div>
        </div>
        {nav ? (
          <nav className="app-header__nav" aria-label="교사 메뉴">
            {nav}
          </nav>
        ) : null}
        <div className="app-header__end">
          <ConnectionBadge />
          <SoundToggle />
          <FullscreenToggle />
        </div>
      </div>
    </header>
  );
}

export function ConnectionBadge() {
  const online = useOnlineStatus();
  return (
    <span className="app-header__connection" role="status">
      {online ? (
        <StatusBadge tone="success" icon="wifi">
          연결됨
        </StatusBadge>
      ) : (
        <StatusBadge tone="danger" icon="wifi_off">
          연결 끊김
        </StatusBadge>
      )}
    </span>
  );
}

function SoundToggle() {
  const { soundEnabled, toggleSound } = useSettings();
  return (
    <button
      type="button"
      className="header-control"
      onClick={toggleSound}
      aria-label={soundEnabled ? '소리 끄기' : '소리 켜기'}
    >
      <Icon name={soundEnabled ? 'volume_up' : 'volume_off'} />
      <span className="header-control__label" aria-hidden="true">
        {soundEnabled ? '소리 켬' : '소리 끔'}
      </span>
    </button>
  );
}

function FullscreenToggle() {
  const { isFullscreen, supported, toggle } = useFullscreen();
  if (!supported) return null;
  return (
    <button
      type="button"
      className="header-control"
      onClick={() => void toggle()}
      aria-label={isFullscreen ? '전체 화면 끝내기' : '전체 화면'}
    >
      <Icon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} />
      <span className="header-control__label" aria-hidden="true">
        {isFullscreen ? '화면 줄이기' : '전체 화면'}
      </span>
    </button>
  );
}
