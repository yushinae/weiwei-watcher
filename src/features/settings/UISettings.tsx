import React, { useState, useEffect } from 'react';

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

  return (
    <div className="flex flex-col gap-4 min-w-[260px]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-white/85">外观</span>
          <span className="text-[11px] text-white/45">
            {theme === 'dark' ? '暗色模式' : '亮色模式'}
          </span>
        </div>
        <span className="h-[24px] px-2 rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[11px] font-semibold text-white/55 flex items-center">
          固定
        </span>
      </div>
    </div>
  );
}
