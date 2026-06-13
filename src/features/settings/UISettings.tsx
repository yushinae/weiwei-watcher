import React, { useState, useEffect } from 'react';
import { Moon } from 'lucide-react';

const THEME_KEY = 'ui-theme';

function getStoredTheme(): 'dark' | 'light' {
  return 'dark';
}

function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<'dark' | 'light'>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, 'dark'); } catch {}
  }, [theme]);

  return { theme, setTheme: setThemeState } as const;
}

export function UISettings() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button type="button" className="bb-top-menu-item flex h-9 w-full items-center gap-3 px-3 text-left">
      <Moon size={16} className="shrink-0 text-[var(--bb-orange)]" />
      <span className="min-w-0 flex-1 whitespace-nowrap text-[13px] font-semibold text-white/80">{isDark ? '暗色模式' : '亮色模式'}</span>
      <span className="bb-top-badge px-1.5 py-0.5 text-[10px] font-bold">固定</span>
    </button>
  );
}
