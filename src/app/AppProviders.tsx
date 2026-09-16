import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RepositoryContext, type RepositoryContextValue } from '../data/RepositoryContext';
import { playSound, type SoundEffect } from '../lib/sound';
import { SettingsContext } from './SettingsContext';

const SOUND_STORAGE_KEY = 'songjeong-festival:sound';

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

interface AppProvidersProps {
  repositoryValue: RepositoryContextValue;
  children: ReactNode;
}

export function AppProviders({ repositoryValue, children }: AppProvidersProps) {
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);

  useEffect(() => {
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? 'on' : 'off');
    } catch {
      // 저장소를 쓸 수 없는 브라우저에서는 이번 접속 동안만 기억한다.
    }
  }, [soundEnabled]);

  const toggleSound = useCallback(() => setSoundEnabled((value) => !value), []);
  const playEffect = useCallback(
    (effect: SoundEffect) => {
      if (soundEnabled) playSound(effect);
    },
    [soundEnabled],
  );

  const settings = useMemo(
    () => ({ soundEnabled, toggleSound, playEffect }),
    [soundEnabled, toggleSound, playEffect],
  );

  return (
    <RepositoryContext.Provider value={repositoryValue}>
      <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
    </RepositoryContext.Provider>
  );
}
