/**
 * Theme (light/dark/system).
 *
 * The initial class is applied by an inline script in index.html BEFORE React
 * mounts — doing it here alone would paint the light theme first and flash to
 * dark. This provider owns changes after that point and keeps the choice in
 * sync with the OS when the user has chosen "system".
 */
import * as React from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'erp-theme';

interface ThemeContextValue {
  theme: Theme;
  /** The theme actually applied — resolves 'system' to light or dark. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private browsing can throw on localStorage access.
    return 'system';
  }
};

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const ThemeProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const [theme, setThemeState] = React.useState<Theme>(readStoredTheme);
  const [systemIsDark, setSystemIsDark] = React.useState(prefersDark);

  // Track OS changes so 'system' stays live rather than being read once.
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent): void => setSystemIsDark(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    // Keeps the mobile browser chrome in step with the app surface.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#0f172a' : '#1d4ed8');
  }, [resolvedTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      // 'system' is stored as an absent key so a later OS change is honoured.
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the in-memory choice still applies this session */
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return context;
};
