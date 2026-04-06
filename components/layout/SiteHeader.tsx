"use client";

import Link from "next/link";
import AuthControls from "@/components/auth/AuthControls";

type HeaderNavItem = {
  label: string;
  href?: string;
  isActive?: boolean;
  onClick?: () => void;
};

type SiteHeaderProps = {
  compact?: boolean;
  navItems?: HeaderNavItem[];
  nextPath?: string;
  showAuthControls?: boolean;
  rightSlot?: React.ReactNode;
};

export default function SiteHeader({
  compact = false,
  navItems = [],
  nextPath = "/",
  showAuthControls = true,
  rightSlot,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-30 mx-auto max-w-7xl px-6 pt-4 transition-all duration-300">
      <div
        className={`grid grid-cols-[1fr_auto_1fr] items-center rounded-full border backdrop-blur-2xl transition-all duration-300 ${
          compact
            ? "border-white/45 bg-white/28 px-4 py-2 shadow-[0_14px_34px_rgba(15,23,42,0.10)] ring-1 ring-white/20"
            : "border-white/35 bg-white/18 px-5 py-2.5 shadow-[0_18px_44px_rgba(15,23,42,0.08)] ring-1 ring-white/16"
        }`}
      >
        <Link
          href="/"
          className={`group relative inline-flex items-center justify-self-start overflow-hidden rounded-full border border-white/80 bg-white/88 shadow-[0_14px_30px_rgba(15,23,42,0.06),0_0_0_1px_rgba(255,255,255,0.34),0_0_24px_rgba(217,70,239,0.10)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-fuchsia-200/80 hover:bg-white hover:shadow-[0_18px_38px_rgba(15,23,42,0.08),0_0_0_1px_rgba(255,255,255,0.42),0_0_32px_rgba(217,70,239,0.16)] active:translate-y-0 active:scale-[0.985] ${
            compact ? "gap-2.5 px-3 py-2" : "gap-3 px-4 py-2.5"
          }`}
          aria-label="Go to home page"
        >
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
          <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
          <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />

          <span
            className={`relative z-10 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_10px_22px_rgba(99,102,241,0.20)] ring-1 ring-white/30 transition-all duration-300 ${
              compact ? "h-9 w-9" : "h-10 w-10"
            }`}
          >
            <img
              src="/ndjc-logo.png"
              alt="Think it Done logo"
              className={`object-contain scale-110 transition-all duration-300 ${
                compact ? "h-6 w-6" : "h-7 w-7"
              }`}
            />
          </span>

          <span className="relative z-10 flex flex-col justify-center leading-none">
            <span
              className={`font-semibold tracking-[0.01em] text-[#0f172a] transition-all duration-300 ${
                compact ? "text-[14px]" : "text-[15px]"
              }`}
            >
              Think it Done
            </span>
            <span
              className={`font-medium text-[#8a96b2] transition-all duration-300 ${
                compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"
              }`}
            >
              Build native Android apps in minutes
            </span>
          </span>
        </Link>

        <nav
          className={`hidden items-center justify-self-center gap-2 font-medium transition-all duration-300 md:flex ${
            compact ? "text-[13px]" : "text-sm"
          }`}
        >
          {navItems.map((item) => {
            if (item.onClick) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  className={`group relative inline-flex items-center rounded-full px-3 py-1.5 transition-all duration-300 ${
                    item.isActive
                      ? "text-[#0f172a]"
                      : "text-[#64748b] hover:bg-white/40 hover:text-[#0f172a]"
                  }`}
                >
                  <span className="relative z-10">{item.label}</span>
                  <span
                    className={`absolute inset-x-3 bottom-[6px] h-[2px] rounded-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500 transition-all duration-300 ${
                      item.isActive
                        ? "opacity-100 scale-x-100"
                        : "opacity-0 scale-x-0 group-hover:opacity-70 group-hover:scale-x-100"
                    }`}
                  />
                </button>
              );
            }

            return (
              <a
                key={item.label}
                href={item.href}
                className={`group relative inline-flex items-center rounded-full px-3 py-1.5 transition-all duration-300 ${
                  item.isActive
                    ? "text-[#0f172a]"
                    : "text-[#64748b] hover:bg-white/40 hover:text-[#0f172a]"
                }`}
              >
                <span className="relative z-10">{item.label}</span>
                <span
                  className={`absolute inset-x-3 bottom-[6px] h-[2px] rounded-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500 transition-all duration-300 ${
                    item.isActive
                      ? "opacity-100 scale-x-100"
                      : "opacity-0 scale-x-0 group-hover:opacity-70 group-hover:scale-x-100"
                  }`}
                />
              </a>
            );
          })}
        </nav>

        <div className="flex items-center justify-self-end gap-3">
          {rightSlot}
          {showAuthControls ? <AuthControls nextPath={nextPath} /> : null}
        </div>
      </div>
    </header>
  );
}
