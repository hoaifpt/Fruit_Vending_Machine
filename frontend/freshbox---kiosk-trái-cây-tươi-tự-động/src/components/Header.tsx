import { type FC, useState, useEffect } from 'react';
import type { CategoryId, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface HeaderProps {
  currentCategory: CategoryId;
  onSelectCategory: (cat: CategoryId) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  language: Language;
  onToggleLanguage: () => void;
  onOpenTelemetry: () => void;
}

export const Header: FC<HeaderProps> = ({
  currentCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  language,
  onToggleLanguage,
  onOpenTelemetry
}) => {
  const t = TRANSLATIONS[language];
  const [timeStr, setTimeStr] = useState('10:45 AM');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString(language === 'vi' ? 'vi-VN' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [language]);

  const navItems: { id: CategoryId; label: string }[] = [
    { id: 'all', label: t.navAll },
    { id: 'fresh', label: t.navFresh },
    { id: 'cut', label: t.navCut },
    { id: 'juice', label: t.navJuice },
    { id: 'combo', label: t.navCombo }
  ];

  return (
    <header className="fixed top-0 left-0 w-full z-40 flex flex-col justify-between px-4 sm:px-6 py-2 bg-white/90 backdrop-blur-md border-b border-black/8 shadow-xs">
      {/* Top Status Bar: Hardware Telemetry & Clock */}
      <div className="flex items-center justify-between text-[13px] text-[#3f4940] border-b border-black/5 pb-1.5">
        {/* Cold-Chain Telemetry Pill */}
        <button
          onClick={onOpenTelemetry}
          className="flex items-center gap-1.5 bg-[#f3f3f3] hover:bg-[#e8e8e8] px-2.5 py-0.5 rounded-[4px] border border-black/10 transition-colors cursor-pointer group"
          title="Xem trạng thái cảm biến làm mát"
        >
          <span className="material-symbols-outlined text-[16px] text-[#006130] group-hover:scale-110 transition-transform">
            thermostat
          </span>
          <span className="font-semibold text-[#1a1c1c]">{t.telemetryNormal}</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#107c41] animate-pulse ml-0.5" />
        </button>

        {/* Kiosk Clock & Telemetry */}
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#6f7a6f]">
              schedule
            </span>
            <span className="font-semibold text-[#1a1c1c] tracking-tight">{timeStr}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#006130]">
              wifi
            </span>
            <span className="font-medium text-[#3f4940]">{t.highSpeed}</span>
          </div>

          {/* Language Switcher */}
          <button
            onClick={onToggleLanguage}
            className="flex items-center gap-1 px-2.5 py-1 bg-[#eeeeee] hover:bg-[#e2e2e2] rounded-[4px] text-[12px] text-[#1a1c1c] font-bold border border-black/10 transition-colors cursor-pointer active:scale-95"
            aria-label="Chuyển đổi ngôn ngữ"
          >
            <span className="material-symbols-outlined text-[14px]">language</span>
            <span>{language === 'vi' ? 'VN / EN' : 'EN / VN'}</span>
          </button>
        </div>
      </div>

      {/* Main Brand App Bar */}
      <div className="flex items-center justify-between pt-2 gap-4">
        {/* Logo Brand Icon & Name */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 bg-[#107c41] text-white rounded-[4px] flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[24px]">eco</span>
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-[#006130] tracking-tight leading-none">
              {t.brandTitle}
            </h1>
            <p className="text-[11px] font-semibold text-[#6f7a6f] tracking-wider uppercase mt-0.5">
              {t.brandSubtitle}
            </p>
          </div>
        </div>

        {/* Rectangular Category Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = currentCategory === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectCategory(item.id)}
                className={`relative font-semibold text-[14px] px-3.5 py-2 transition-colors cursor-pointer whitespace-nowrap rounded-[4px] ${
                  isActive
                    ? 'text-[#006130] after:absolute after:bottom-0 after:left-1 after:right-1 after:h-[3px] after:bg-[#006130]'
                    : 'text-[#3f4940] hover:bg-[#eeeeee]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Search bar trigger */}
        <div className="flex items-center gap-2 bg-[#f3f3f3] border border-black/10 px-3 py-1.5 rounded-[4px] w-52 sm:w-64 focus-within:border-[#107c41] focus-within:bg-white transition-all">
          <span className="material-symbols-outlined text-[18px] text-[#6f7a6f]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-transparent text-[13px] text-[#1a1c1c] placeholder-[#6f7a6f] focus:outline-none w-full border-none p-0"
            placeholder={t.searchPlaceholder}
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="text-[#6f7a6f] hover:text-[#1a1c1c] text-[16px] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
