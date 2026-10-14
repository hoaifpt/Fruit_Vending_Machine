import type { FC } from 'react';
import type { KioskStep, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface FooterStepperProps {
  currentStep: KioskStep;
  language: Language;
  onStepChange: (step: KioskStep) => void;
  onCallStaff: () => void;
  canNavigateToStep2: boolean;
}

export const FooterStepper: FC<FooterStepperProps> = ({
  currentStep,
  language,
  onStepChange,
  onCallStaff,
  canNavigateToStep2
}) => {
  const t = TRANSLATIONS[language];

  return (
    <footer className="fixed bottom-0 left-0 w-full z-40 flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white/95 backdrop-blur-lg border-t border-black/8 shadow-md">
      {/* 3-Step Kiosk Workflow */}
      <div className="flex items-center gap-2 sm:gap-4 flex-1 max-w-3xl overflow-x-auto scrollbar-none py-0.5">
        {/* Step 1 */}
        <button
          onClick={() => onStepChange(1)}
          className={`flex items-center justify-center gap-2 rounded-[4px] px-3 sm:px-4 py-1.5 font-bold transition-all cursor-pointer whitespace-nowrap text-[13px] sm:text-[14px] ${
            currentStep === 1
              ? 'bg-[#107c41] text-white shadow-xs'
              : 'bg-[#eeeeee] hover:bg-[#e2e2e2] text-[#3f4940] border border-black/8 font-medium'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">touch_app</span>
          <span>{t.step1}</span>
        </button>

        {/* Arrow indicator */}
        <span className="material-symbols-outlined text-[#6f7a6f]/50 text-[16px] shrink-0">
          arrow_forward_ios
        </span>

        {/* Step 2 */}
        <button
          onClick={() => {
            if (canNavigateToStep2 || currentStep === 2 || currentStep === 3) {
              onStepChange(2);
            }
          }}
          className={`flex items-center justify-center gap-2 rounded-[4px] px-3 sm:px-4 py-1.5 font-bold transition-all cursor-pointer whitespace-nowrap text-[13px] sm:text-[14px] ${
            currentStep === 2
              ? 'bg-[#107c41] text-white shadow-xs'
              : 'bg-[#eeeeee] hover:bg-[#e2e2e2] text-[#3f4940] border border-black/8 font-medium'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            qr_code_scanner
          </span>
          <span>{t.step2}</span>
        </button>

        {/* Arrow indicator */}
        <span className="material-symbols-outlined text-[#6f7a6f]/50 text-[16px] shrink-0">
          arrow_forward_ios
        </span>

        {/* Step 3 */}
        <button
          onClick={() => {
            if (currentStep === 3) onStepChange(3);
          }}
          className={`flex items-center justify-center gap-2 rounded-[4px] px-3 sm:px-4 py-1.5 font-bold transition-all cursor-pointer whitespace-nowrap text-[13px] sm:text-[14px] ${
            currentStep === 3
              ? 'bg-[#107c41] text-white shadow-xs'
              : 'bg-[#eeeeee] text-[#3f4940] border border-black/8 font-medium'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            shopping_bag
          </span>
          <span>{t.step3}</span>
        </button>
      </div>

      {/* Kiosk ID & Hotline Telemetry */}
      <div className="flex items-center gap-3 sm:gap-4 text-[13px] shrink-0">
        <div className="text-right hidden sm:block">
          <span className="font-bold text-[#1a1c1c] block leading-tight">
            {t.kioskId}
          </span>
          <span className="text-[11px] text-[#6f7a6f]">{t.hotlineLabel}</span>
        </div>

        <div className="h-7 w-px bg-black/10 hidden sm:block" />

        <button
          onClick={onCallStaff}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f3f3f3] hover:bg-[#e2e2e2] active:bg-[#dadada] rounded-[4px] border border-black/10 text-[#1a1c1c] text-[12px] font-bold transition-colors cursor-pointer shadow-2xs"
        >
          <span className="material-symbols-outlined text-[16px] text-[#006130]">
            call
          </span>
          <span>{t.callStaff}</span>
        </button>
      </div>
    </footer>
  );
};
