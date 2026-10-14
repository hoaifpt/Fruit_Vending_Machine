import { type FC, useState } from 'react';
import type { Language } from '../types';

interface StaffModalProps {
  language: Language;
  onClose: () => void;
}

export const StaffModal: FC<StaffModalProps> = ({ language, onClose }) => {
  const isEn = language === 'en';
  const [called, setCalled] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-[8px] border border-black/10 shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/8 bg-[#f9f9f9]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#006130]">
              support_agent
            </span>
            <span className="font-bold text-[15px] text-[#1a1c1c]">
              {isEn ? 'Kiosk Staff Assistance' : 'Hỗ trợ khách hàng tại Kiosk'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-[#6f7a6f] hover:text-[#1a1c1c] hover:bg-[#eeeeee] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-[13px]">
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-[#8af5be]/30 text-[#006130] mx-auto flex items-center justify-center mb-2.5">
              <span className="material-symbols-outlined text-[32px]">call</span>
            </div>
            <h3 className="font-bold text-[16px] text-[#1a1c1c]">
              {isEn ? 'Central Mall Floor Attendant' : 'Nhân viên phụ trách Tầng 1 TTTM'}
            </h3>
            <p className="text-[#6f7a6f] text-[12px] mt-0.5">
              {isEn
                ? 'On-site technical support within 1–2 minutes'
                : 'Hỗ trợ kỹ thuật và kiểm tra trực tiếp trong 1 - 2 phút'}
            </p>
          </div>

          {called ? (
            <div className="p-3.5 bg-[#8af5be]/30 border border-[#006130]/30 rounded-[6px] text-center text-[#005235]">
              <span className="material-symbols-outlined text-[28px] text-[#006130] block mb-1">
                notifications_active
              </span>
              <p className="font-bold text-[14px]">
                {isEn ? 'Staff Alert Sent!' : 'Đã gửi tín hiệu gọi nhân viên!'}
              </p>
              <p className="text-[12px] mt-1 text-[#005235]/80">
                {isEn
                  ? 'An on-duty attendant is walking to Kiosk #08 now.'
                  : 'Nhân viên trực tầng đang di chuyển đến Kiosk #08.'}
              </p>
            </div>
          ) : (
            <button
              onClick={() => setCalled(true)}
              className="w-full py-3 bg-[#107c41] hover:bg-[#0c6233] text-white rounded-[6px] font-bold text-[14px] flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">
                ring_volume
              </span>
              <span>
                {isEn ? 'Ring Floor Attendant' : 'Nhấn chuông gọi nhân viên trực tiếp'}
              </span>
            </button>
          )}

          <div className="p-3 bg-[#f3f3f3] rounded-[6px] border border-black/8 text-[12px] space-y-1">
            <div className="flex justify-between">
              <span className="text-[#6f7a6f]">Hotline 24/7:</span>
              <strong className="text-[#006130] font-mono text-[13px]">1900 8888</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6f7a6f]">Mã định danh Kiosk:</span>
              <strong className="text-[#1a1c1c] font-mono">KIOSK-08-HCM-L1</strong>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-black/8 bg-[#f9f9f9] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-[4px] border border-black/10 text-[13px] text-[#1a1c1c] hover:bg-[#eeeeee] cursor-pointer"
          >
            {isEn ? 'Close' : 'Đóng'}
          </button>
        </div>
      </div>
    </div>
  );
};
