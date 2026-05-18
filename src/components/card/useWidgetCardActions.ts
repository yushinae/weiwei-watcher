import { useEffect, useMemo, useState } from 'react';

/**
 * 让 actions “可发现但克制”：
 * - 支持 hover 的桌面端：默认低不透明度可见，hover/focus 提亮
 * - 触屏/不可 hover：常显
 */
export function useWidgetCardActions() {
  const [canHover, setCanHover] = useState(true);
  const [finePointer, setFinePointer] = useState(true);

  useEffect(() => {
    const mqHover = window.matchMedia?.('(hover: hover)');
    const mqFine = window.matchMedia?.('(pointer: fine)');
    const update = () => {
      setCanHover(!!mqHover?.matches);
      setFinePointer(!!mqFine?.matches);
    };
    update();
    mqHover?.addEventListener?.('change', update);
    mqFine?.addEventListener?.('change', update);
    return () => {
      mqHover?.removeEventListener?.('change', update);
      mqFine?.removeEventListener?.('change', update);
    };
  }, []);

  return useMemo(() => {
    const alwaysVisible = !(canHover && finePointer);
    return {
      actionsVisibility: alwaysVisible ? 'always' : ('subtle' as const),
      actionsBaseOpacityClass: alwaysVisible ? 'opacity-100' : 'opacity-40 group-hover/card:opacity-100 group-focus-within/card:opacity-100',
    };
  }, [canHover, finePointer]);
}

