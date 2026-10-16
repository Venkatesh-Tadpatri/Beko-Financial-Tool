import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

/**
 * Thin ECharts wrapper: initialises once, re-applies the option when it changes,
 * and resizes with its container. The chart fills its parent, so size it with a
 * height on the wrapping element (e.g. `className="h-64"`).
 */
export function Chart({ option, className = '' }: { option: echarts.EChartsCoreOption; className?: string }) {
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
    try {
      chart.current?.setOption(option, true);
    } catch (e) {
      // A malformed option must not blank the chart silently.
      console.error('Chart option error:', e);
    }
  }, [option]);

  return <div ref={el} className={className} role="img" />;
}
