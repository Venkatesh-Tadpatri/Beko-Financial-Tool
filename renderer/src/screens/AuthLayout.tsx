import { useEffect, useRef, useState, type ReactNode } from 'react';
import bekoLogo from '../assets/beko-logo.png';

/**
 * Layout for every screen before sign-in: blue brand panel with an illustrated
 * dashboard on the left (wide windows only), white card with the form on the right.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full overflow-hidden bg-gradient-to-br from-[#eef5ff] via-[#e3efff] to-[#d5e7ff]">
      <BrandPanel />
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-6 lg:justify-end lg:pr-[4vw]">
        <div className="w-full max-w-[460px] rounded-3xl bg-white px-10 py-8 shadow-[0_24px_60px_-20px_rgba(15,50,140,0.35)] [@media(max-height:760px)]:py-6">
          <div className="flex flex-col items-center text-center">
            <img src={bekoLogo} alt="BEKO" className="h-[96px] w-[96px] object-contain [@media(max-height:760px)]:h-[72px] [@media(max-height:760px)]:w-[72px]" />
            <h1 className="mt-4 text-[28px] font-semibold text-[#0b1f4d]">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          </div>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

const FEATURES = [
  { label: 'Turnover Analysis', from: '#2f8bff', to: '#1557e6', icon: 'M5 20V12M10 20V6M15 20v-9M20 20V9' },
  { label: 'Margins & Profitability', from: '#b16cff', to: '#7a3ff2', icon: 'M12 3a9 9 0 1 0 9 9h-9V3Zm2-.8V10h7.8A9 9 0 0 0 14 2.2Z' },
  { label: 'Cash Flow Insights', from: '#2fd29a', to: '#13a46f', icon: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7m-16 5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5' },
  { label: 'Forecasting & Trends', from: '#ffa53a', to: '#f26b1d', icon: 'M3 17l6-6 4 4 8-8m0 0h-6m6 0v6' },
];

function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="absolute inset-y-0 left-0 hidden w-[60%] overflow-hidden text-white lg:block"
      style={{
        background: 'linear-gradient(140deg, #0a2272 0%, #0c3bc4 45%, #1766f5 100%)',
        clipPath: 'polygon(0 0, 100% 0, 84% 100%, 0 100%)',
      }}
    >
      {/* background bars and glowing trend line */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5aa0ff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#5aa0ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#38e1ff" stopOpacity="0" />
            <stop offset="0.4" stopColor="#38e1ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#7af0ff" />
          </linearGradient>
        </defs>
        {[300, 360, 420, 470, 530, 600, 660, 720, 780].map((h, i) => (
          <rect key={i} x={560 + i * 46} y={900 - h} width="30" height={h} rx="4" fill="url(#bar)" />
        ))}
        <path d="M0 560 C 180 600, 300 520, 420 470 S 700 330, 1000 180" fill="none" stroke="url(#glow)" strokeWidth="4" />
        <circle cx="120" cy="566" r="7" fill="#7af0ff" />
        <circle cx="880" cy="240" r="7" fill="#7af0ff" />
      </svg>

      <div className="relative flex h-full flex-col px-[4.5vw] pt-[5vh]">
        <div className="flex items-start gap-7">
          <div className="shrink-0 rounded-md bg-white p-1.5 shadow-lg">
            <img src={bekoLogo} alt="" className="h-[92px] w-[92px] object-contain" />
          </div>
          <div>
            <div className="font-heading text-[44px] font-semibold leading-none tracking-tight">
              Financial <span className="text-[#3fd0ff]">Visualization</span>
            </div>
            <div className="mt-1 font-heading text-[40px] font-light leading-tight">Tool</div>
            <div className="mt-4 h-[3px] w-16 rounded-full bg-[#3fd0ff]" />
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-blue-100/90">
              Turn financial data into clear insights. Track performance, analyse trends and make informed decisions — all in one place.
            </p>
          </div>
        </div>

        <div className="mt-[3.5vh] flex gap-6">
          {FEATURES.map((f) => (
            <div key={f.label} className="w-[104px] text-center">
              <div
                className="mx-auto grid h-[62px] w-[62px] place-items-center rounded-2xl shadow-lg"
                style={{ background: `linear-gradient(145deg, ${f.from}, ${f.to})` }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </div>
              <div className="mt-2 text-[13px] font-medium leading-tight">{f.label}</div>
            </div>
          ))}
        </div>

        <div className="relative mt-[3vh] min-h-0 flex-1">
          <Laptop />
        </div>
      </div>
    </aside>
  );
}

/** Illustrative dashboard on a laptop. Figures are decorative, not real data. */
const LAPTOP_W = 660;
const BOTTOM_GAP = 28; // keep the whole laptop, base included, inside the panel
const TILT_ALLOWANCE = 1.12; // the 3D tilt makes the drawn laptop a little taller than its box

/** Scales the fixed-size illustration to whatever space is left under the feature tiles. */
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const laptop = ref.current;
    const el = laptop?.parentElement;
    if (!laptop || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      const naturalH = laptop.offsetHeight * TILT_ALLOWANCE; // offset sizes ignore transforms
      const naturalW = laptop.offsetWidth;
      setScale(Math.max(0.3, Math.min(1.15, (height - BOTTOM_GAP) / naturalH, (width * 0.9) / naturalW)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

function Laptop() {
  const { ref, scale } = useFitScale();
  const kpis = [
    { t: 'Total Turnover', v: '₹124.6 Cr', d: '12.5%', line: 'M0 30 L15 24 L30 27 L45 16 L60 19 L75 8 L90 4', c: '#3fd0ff' },
    { t: 'Gross Margin', v: '32.8%', d: '4.2%', line: 'M0 28 L15 22 L30 26 L45 15 L60 20 L75 10 L90 6', c: '#c47bff' },
    { t: 'Cash Flow', v: '₹21.4 Cr', d: '8.6%', bars: [8, 12, 10, 16, 14, 20, 24], c: '#2fe0a0' },
    { t: 'Forecast', v: '₹156 Cr', d: '18.3%', bars: [6, 10, 9, 14, 18, 22, 28], c: '#4f8dff' },
  ];
  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const trend = [22, 26, 24, 30, 33, 36, 40, 44, 50, 56, 60, 66];
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-[2%] origin-bottom-left"
      style={{
        bottom: BOTTOM_GAP,
        width: LAPTOP_W,
        transform: `scale(${scale}) perspective(1600px) rotateY(-14deg) rotateX(6deg) rotateZ(-3deg)`,
      }}
    >
      <div className="rounded-t-[18px] border-[10px] border-b-[14px] border-[#11131c] bg-[#0c1530] p-4 shadow-[0_40px_80px_rgba(0,0,0,0.5)]">
        <div className="grid grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div key={k.t} className="rounded-lg bg-[#16224a] p-3">
              <div className="text-[10px] text-blue-100/80">{k.t}</div>
              <div className="mt-1 font-heading text-[19px] font-semibold">{k.v}</div>
              <div className="text-[9px] text-emerald-300">▲ {k.d}</div>
              <svg viewBox="0 0 90 34" className="mt-1 h-8 w-full">
                {k.line ? (
                  <path d={k.line} fill="none" stroke={k.c} strokeWidth="2" />
                ) : (
                  k.bars!.map((b, i) => <rect key={i} x={i * 13} y={34 - b} width="8" height={b} rx="1.5" fill={k.c} />)
                )}
              </svg>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1.6fr] gap-3">
          <div className="rounded-lg bg-[#16224a] p-3">
            <div className="text-[10px] text-blue-100/80">Revenue by Segment</div>
            <div className="mt-2 flex items-center gap-3">
              <svg viewBox="0 0 42 42" className="h-[74px] w-[74px] -rotate-90">
                {[
                  { p: 45, c: '#3fd0ff', o: 0 },
                  { p: 25, c: '#4f6dff', o: 45 },
                  { p: 20, c: '#ff5e9a', o: 70 },
                  { p: 10, c: '#ffb23f', o: 90 },
                ].map((s) => (
                  <circle key={s.c} cx="21" cy="21" r="15.9" fill="none" stroke={s.c} strokeWidth="7" strokeDasharray={`${s.p} ${100 - s.p}`} strokeDashoffset={-s.o} />
                ))}
              </svg>
              <div className="space-y-1 text-[9px]">
                {[['Industrial', '45%', '#3fd0ff'], ['Service', '25%', '#4f6dff'], ['OEM', '20%', '#ff5e9a'], ['Other', '10%', '#ffb23f']].map(([n, p, c]) => (
                  <div key={n} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
                    <span className="w-12">{n}</span>
                    <span className="text-blue-100/70">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-[#16224a] p-3">
            <div className="text-[10px] text-blue-100/80">Monthly Trend</div>
            <svg viewBox="0 0 240 80" className="mt-1 h-[84px] w-full">
              <defs>
                <linearGradient id="mt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#5f8cff" />
                  <stop offset="1" stopColor="#2f4fd6" />
                </linearGradient>
              </defs>
              {trend.map((v, i) => (
                <rect key={i} x={6 + i * 19.5} y={70 - v} width="11" height={v} rx="2" fill="url(#mt)" />
              ))}
              {months.map((m, i) => (
                <text key={m} x={11.5 + i * 19.5} y="79" fontSize="5.5" textAnchor="middle" fill="#9fb4e6">{m}</text>
              ))}
            </svg>
          </div>
        </div>
      </div>
      <div className="mx-[-4%] h-[14px] rounded-b-[14px] bg-gradient-to-b from-[#c9ced8] to-[#8d93a0]" />
    </div>
  );
}
