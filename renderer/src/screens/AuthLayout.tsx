import type { ReactNode } from 'react';
import { Logo } from '../components/ui';

/** Split layout for every pre-login screen: brand panel left, form right. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <aside className="relative hidden w-[42%] max-w-[560px] flex-col justify-between overflow-hidden bg-navy-900 p-10 lg:flex">
        <Logo light />
        <div className="relative z-10 max-w-sm">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            Your SAP numbers, <span className="text-accent-400">clearly</span> on one screen.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-300">
            Turnover, margins, cash and forecasts, built from approved data and kept safe on this computer.
          </p>
        </div>
        <p className="relative z-10 text-xs text-navy-300">Data stays on this PC · Backed up automatically</p>
        <svg className="pointer-events-none absolute -bottom-6 -right-10 opacity-[0.16]" width="520" height="300" aria-hidden="true">
          {[40, 70, 60, 110, 95, 150, 140, 190, 220].map((h, i) => (
            <rect key={i} x={i * 56} y={300 - h} width="34" height={h} rx="6" fill={i % 3 === 2 ? '#2dd4bf' : '#ffffff'} />
          ))}
        </svg>
      </aside>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[26px] font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
