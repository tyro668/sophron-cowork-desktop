import { nativeTheme } from 'electron';
import { configStore, type AppTheme } from '../config/config-store';

export const DARK_BG = '#171614';
export const LIGHT_BG = '#f5f3ee';

export function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

export function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

export function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
}
