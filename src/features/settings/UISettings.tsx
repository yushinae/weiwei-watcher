import React, { useState, useEffect, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';

const THEME_KEY = 'ui-theme';

function getStoredTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light') return 'light';
  } catch {}
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
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  }, []);

  return { theme, toggleTheme } as const;
}

export function UISettings(_props: { onClose?: () => void }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex flex-col gap-4 min-w-[260px]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-white/85">外观</span>
          <span className="text-[11px] text-white/45">
            {theme === 'dark' ? '暗色模式' : '亮色模式'}
          </span>
        </div>
        <button
          onClick={toggleTheme}
          className={cn(
            'relative w-[52px] h-[28px] rounded-full transition-colors duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            'ring-1 ring-inset',
            theme === 'dark'
              ? 'bg-white/[0.06] ring-white/[0.12]'
              : 'bg-brand/25 ring-brand/40',
          )}
        >
          <div
            className={cn(
              'absolute top-[3px] flex items-center justify-center w-[22px] h-[22px] rounded-full',
              'transition-transform duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
              'bg-white shadow-[0_2px_6px_rgba(0,0,0,0.30)]',
              theme === 'dark' ? 'left-[3px]' : 'translate-x-[24px] left-[3px]',
            )}
          >
            {theme === 'dark'
              ? <Moon size={13} className="text-slate-400" />
              : <Sun size={13} className="text-amber-400" />
            }
          </div>
        </button>
      </div>
    </div>
  );
}
