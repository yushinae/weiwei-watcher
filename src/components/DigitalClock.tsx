import React, { useState, useEffect } from 'react';

const DigitalClock = React.memo(() => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const t = time.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const i = t.lastIndexOf(' ');

  return (
    <div className="flex items-center justify-center px-2 h-[36px] bg-white/5 hover:bg-white/10 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] rounded-[8px] text-slate-200">
      <span className="text-[18px] font-mono font-bold tnum tracking-wide mt-px text-slate-200">{t.slice(0, i)}</span>
      <span className="text-[11px] font-bold font-mono tnum text-text-muted ml-0.5 mt-px">{t.slice(i + 1)}</span>
    </div>
  );
});

DigitalClock.displayName = 'DigitalClock';

export default DigitalClock;
