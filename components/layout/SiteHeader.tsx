"use client";

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
        <div
          className={`flex items-center justify-self-start transition-all duration-300 ${
            compact ? "gap-2.5" : "gap-3"
          }`}
        >
          <div
            className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_10px_22px_rgba(99,102,241,0.20)] overflow-hidden ring-1 ring-white/30 transition-all duration-300 ${
              compact ? "h-8 w-8" : "h-9 w-9"
            }`}
          >
            <img
              src="/ndjc-logo.png"
              alt="Think it Done logo"
              className={`object-contain scale-110 transition-all duration-300 ${
                compact ? "h-6 w-6" : "h-7 w-7"
              }`}
            />
          </div>

          <div className="leading-none">
            <div
              className={`font-semibold tracking-[0.01em] text-[#0f172a] transition-all duration-300 ${
                compact ? "text-[14px]" : "text-[15px]"
              }`}
            >
              Think it Done
            </div>
            <div
              className={`font-medium text-[#8a96b2] transition-all duration-300 ${
                compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"
              }`}
            >
              Build native Android apps in minutes
            </div>
          </div>
        </div>

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