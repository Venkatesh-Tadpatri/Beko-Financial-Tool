import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

/**
 * Thin ECharts wrapper: initialises once, re-applies the option when it changes,
 * and resizes with its container. The chart fills its parent, so size it with a
 * height on the wrapping element (e.g. `className="h-64"`).
 */
const TOOLTIP_DEFAULTS = {
  // Render tooltips on the page body so rounded cards (overflow: hidden) and
  // overlays such as a donut's centre total can never clip or cover them.
  appendTo: 'body',
  backgroundColor: '#ffffff',
  borderColor: '#cbd5e1',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: '#0b1b4d', fontSize: 13 },
  extraCssText: 'z-index: 9999; border-radius: 10px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18); white-space: nowrap;',
};

/** Fills in the shared tooltip settings; a chart's own settings win. */
export function withTooltipDefaults(option: echarts.EChartsCoreOption): echarts.EChartsCoreOption {
  const tip = option.tooltip;
  if (!tip) return option;
  const apply = (t: Record<string, unknown>) => ({ ...TOOLTIP_DEFAULTS, ...t, textStyle: { ...TOOLTIP_DEFAULTS.textStyle, ...(t.textStyle as object | undefined) } });
  return { ...option, tooltip: Array.isArray(tip) ? tip.map(apply) : apply(tip as Record<string, unknown>) };
}

export function Chart({ option, className = '', onEvents }: { option: echarts.EChartsCoreOption; className?: string; onEvents?: Record<string, (params: any) => void> }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const instance = echarts.init(el.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => instance.resize()) : null;
    ro?.observe(el.current);
    // Nudge a resize once layout settles, in case the container had no size at init.
    const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => instance.resize()) : 0;
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || !onEvents) return;
    for (const [event, handler] of Object.entries(onEvents)) instance.on(event, handler);
    return () => {
      for (const [event, handler] of Object.entries(onEvents)) instance.off(event, handler);
    };
  }, [onEvents]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    try {
      // A tooltip or hover shadow left over from the old data can make the
      // replacement fail and leave the previous picture on screen.
      instance.dispatchAction({ type: 'hideTip' });
      instance.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
      instance.setOption(withTooltipDefaults(option), true);
    } catch (e) {
      console.error('Chart option error, redrawing from scratch:', e);
      try {
        instance.clear();
        instance.setOption(withTooltipDefaults(option), true);
      } catch (e2) {
        console.error('Chart option error:', e2);
      }
    }
  }, [option]);

  return <div ref={el} className={className} role="img" />;
}
