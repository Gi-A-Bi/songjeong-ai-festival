import { createContext, useContext } from 'react';
import type { SoundEffect } from '../lib/sound';

export interface SettingsValue {
  soundEnabled: boolean;
  toggleSound: () => void;
  playEffect: (effect: SoundEffect) => void;
}

export const SettingsContext = createContext<SettingsValue>({
  soundEnabled: false,
  toggleSound: () => undefined,
  playEffect: () => undefined,
});

export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}
