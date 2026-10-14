import type { FC } from 'react';
import type { Language } from '../types';

interface TelemetryModalProps {
  language: Language;
  onClose: () => void;
}

export const TelemetryModal: FC<TelemetryModalProps> = ({
  language,
  onClose
}) => {
  const isEn = language === 'en';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-[8px] border border-black/10 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/8 bg-[#f9f9f9]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-[#006130]">
              thermostat
            </span>
            <span className="font-bold text-[15px] text-[#1a1c1c]">
              {isEn ? 'Kiosk Cold-Chain & UV-C Telemetry' : 'Báo cáo Kiểm soát Làm mát & Tiệt trùng UV-C'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-[#6f7a6f] hover:text-[#1a1c1c] hover:bg-[#eeeeee] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Diagnostic Metrics */}
        <div className="p-5 space-y-4 text-[13px]">
          <div className="p-3 bg-[#8af5be]/20 border border-[#8af5be] rounded-[6px] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#107c41] animate-pulse" />
              <span className="font-bold text-[#005235]">
                {isEn ? 'All Systems Operating Optimally' : 'Hệ thống vận hành chuẩn xác 100%'}
              </span>
            </div>
            <span className="text-[12px] font-mono text-[#005235] font-semibold">
              4.0°C Target
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#f3f3f3] rounded-[6px] border border-black/8">
              <span className="text-[11px] text-[#6f7a6f] block">
                {isEn ? 'Upper Chamber Temp' : 'Nhiệt độ khoang trên'}
              </span>
              <span className="text-[20px] font-mono font-bold text-[#006130]">
                3.8°C
              </span>
              <span className="text-[11px] text-[#6f7a6f] block mt-0.5">
                {isEn ? 'Set limit: 2°C - 5°C' : 'Giới hạn: 2°C - 5°C'}
              </span>
            </div>

            <div className="p-3 bg-[#f3f3f3] rounded-[6px] border border-black/8">
              <span className="text-[11px] text-[#6f7a6f] block">
                {isEn ? 'Lower Chamber Temp' : 'Nhiệt độ khoang dưới'}
              </span>
              <span className="text-[20px] font-mono font-bold text-[#006130]">
                4.1°C
              </span>
              <span className="text-[11px] text-[#6f7a6f] block mt-0.5">
                {isEn ? 'Set limit: 2°C - 5°C' : 'Giới hạn: 2°C - 5°C'}
              </span>
            </div>

            <div className="p-3 bg-[#f3f3f3] rounded-[6px] border border-black/8">
              <span className="text-[11px] text-[#6f7a6f] block">
                {isEn ? 'Relative Humidity (RH)' : 'Độ ẩm khoang mát (RH)'}
              </span>
              <span className="text-[20px] font-mono font-bold text-[#1a1c1c]">
                86%
              </span>
              <span className="text-[11px] text-[#6f7a6f] block mt-0.5">
                {isEn ? 'Prevents fruit drying' : 'Giữ mọng nước tối ưu'}
              </span>
            </div>

            <div className="p-3 bg-[#f3f3f3] rounded-[6px] border border-black/8">
              <span className="text-[11px] text-[#6f7a6f] block">
                {isEn ? 'UV-C Germicidal Cycle' : 'Chu kỳ tia UV-C 254nm'}
              </span>
              <span className="text-[20px] font-mono font-bold text-[#006130]">
                ACTIVE
              </span>
              <span className="text-[11px] text-[#6f7a6f] block mt-0.5">
                {isEn ? 'Auto pulse every 30m' : 'Tự động tiệt trùng khép kín'}
              </span>
            </div>
          </div>

          {/* Restock History Log */}
          <div className="p-3 bg-[#f9f9f9] rounded-[6px] border border-black/8">
            <span className="font-bold text-[12px] text-[#1a1c1c] block mb-2">
              {isEn ? 'Restock & Quality Audit Log' : 'Nhật ký nạp hàng & kiểm định an toàn'}
            </span>
            <div className="space-y-1.5 text-[12px] text-[#3f4940]">
              <div className="flex justify-between">
                <span>06:00 AM Hôm nay:</span>
                <span className="font-medium text-[#1a1c1c]">
                  Nạp 24 khay trái cây VietGAP xe lạnh #51D-89412
                </span>
              </div>
              <div className="flex justify-between">
                <span>08:30 AM Hôm nay:</span>
                <span className="font-medium text-[#1a1c1c]">
                  Cắt bổ sung 10 hộp dưa lưới & kiwi tươi
                </span>
              </div>
              <div className="flex justify-between">
                <span>Kiểm định viên:</span>
                <span className="font-medium text-[#006130]">
                  KCS #VN-902 (Đạt chuẩn 100%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-black/8 bg-[#f9f9f9] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#006130] hover:bg-[#007c46] text-white rounded-[4px] font-bold text-[13px] transition-colors cursor-pointer"
          >
            {isEn ? 'Close Diagnostics' : 'Đóng kiểm tra'}
          </button>
        </div>
      </div>
    </div>
  );
};
