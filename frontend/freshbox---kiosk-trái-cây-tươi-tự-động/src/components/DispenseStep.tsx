import { type FC, useState } from 'react';
import type { CartItem, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface DispenseStepProps {
  items: CartItem[];
  language: Language;
  onFinishOrder: () => void;
}

export const DispenseStep: FC<DispenseStepProps> = ({
  items,
  language,
  onFinishOrder
}) => {
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';
  const [receiptPrinted, setReceiptPrinted] = useState(false);
  const [itemsCollected, setItemsCollected] = useState(false);

  // Group items by locker slot
  const lockerSlots = items.map((item, idx) => ({
    slot: item.product.lockerSlot || `A-0${idx + 1}`,
    name: isEn ? item.product.nameEn : item.product.name,
    qty: item.quantity,
    temp: item.product.temp || 3.8
  }));

  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const discount = subtotal >= 100000 ? 35000 : 0;
  const totalPaid = Math.max(0, subtotal - discount);

  return (
    <div className="flex-1 flex flex-col max-w-[1200px] mx-auto w-full">
      {/* Top Banner Alert */}
      <div className="bg-[#107c41] text-white p-5 rounded-[8px] shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-[6px] bg-white/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[32px] text-white animate-bounce">
              lock_open
            </span>
          </div>
          <div>
            <h2 className="text-[20px] sm:text-[22px] font-bold tracking-tight">
              {t.dispenseTitle}
            </h2>
            <p className="text-[14px] text-white/90">
              {t.dispenseSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-black/20 px-3.5 py-1.5 rounded-[4px] text-[13px] font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-[#8af5be] animate-ping" />
          <span>Chiller: 3.8°C Active</span>
        </div>
      </div>

      {/* Main Grid: Interactive Locker Bay Simulation & Receipt */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Visual Locker Bay Simulator */}
        <div className="lg:col-span-2 bg-white rounded-[8px] border border-black/10 p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-black/8">
              <h3 className="text-[17px] font-bold text-[#1a1c1c] flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-[#006130]">
                  kitchen
                </span>
                <span>
                  {isEn ? 'Automated Cold Locker Compartments' : 'Sơ đồ khoang làm mát tự động'}
                </span>
              </h3>
              <span className="text-[12px] font-bold text-[#006130] bg-[#8af5be]/25 px-2 py-0.5 rounded-[4px]">
                {t.uvcSafe}
              </span>
            </div>

            {/* Locker Visual Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 mt-5">
              {lockerSlots.map((item, idx) => (
                <div
                  key={idx}
                  className="relative p-4 rounded-[6px] border-2 border-[#107c41] bg-gradient-to-b from-[#8af5be]/10 to-[#8af5be]/25 shadow-xs overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 bg-[#107c41] text-white text-[12px] font-mono font-bold rounded">
                      {item.slot}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#006130]">
                      <span className="w-2 h-2 rounded-full bg-[#107c41] animate-pulse" />
                      UNLOCKED
                    </span>
                  </div>

                  <h4 className="font-bold text-[14px] text-[#1a1c1c] line-clamp-1 mt-1">
                    {item.name}
                  </h4>
                  <div className="flex justify-between items-center text-[12px] text-[#6f7a6f] mt-2 pt-2 border-t border-black/5">
                    <span>{isEn ? 'Qty:' : 'Số lượng:'} <strong className="text-[#1a1c1c]">{item.qty}</strong></span>
                    <span className="text-[#006130] font-mono font-semibold">{item.temp}°C</span>
                  </div>

                  {/* Mechanical open hatch effect */}
                  <div className="mt-3 py-1 px-2 bg-white/80 rounded border border-black/5 text-[11px] text-[#006130] font-semibold text-center flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">
                      door_open
                    </span>
                    <span>{isEn ? 'Door Open - Pull gently' : 'Cửa mở - Kéo nhẹ'}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Verification Checklist */}
            <div className="mt-6 p-4 bg-[#f9f9f9] rounded-[6px] border border-black/8">
              <h4 className="text-[13px] font-bold text-[#1a1c1c] mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[#006130]">
                  checklist
                </span>
                <span>{t.takeItemsNote}</span>
              </h4>
              <div className="space-y-1.5">
                {items.map(({ product, quantity }) => (
                  <label
                    key={product.id}
                    className="flex items-center gap-2 text-[13px] text-[#3f4940] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      defaultChecked={true}
                      className="w-4 h-4 rounded text-[#006130] focus:ring-[#006130]"
                    />
                    <span>
                      {quantity}x {isEn ? product.nameEn : product.name} ({product.unit.replace('/ ', '')})
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="mt-6 pt-4 border-t border-black/8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={() => {
                setReceiptPrinted(true);
                setTimeout(() => setReceiptPrinted(false), 4000);
              }}
              className="w-full sm:w-auto px-4 py-2.5 bg-[#f3f3f3] hover:bg-[#e8e8e8] text-[#1a1c1c] border border-black/10 rounded-[6px] font-bold text-[13px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">
                receipt_long
              </span>
              <span>{receiptPrinted ? t.receiptPrinted : t.printReceiptBtn}</span>
            </button>

            <button
              onClick={onFinishOrder}
              className="w-full sm:w-auto px-6 py-2.5 bg-[#107c41] hover:bg-[#0c6233] text-white rounded-[6px] font-bold text-[14px] flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">
                task_alt
              </span>
              <span>{t.finishBtn}</span>
            </button>
          </div>
        </div>

        {/* Thermal E-Receipt / QR Provenance */}
        <div className="acrylic-layer rounded-[8px] border border-black/10 p-5 bg-white/80 backdrop-blur-md shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-center pb-3 border-b border-dashed border-black/15">
              <div className="w-8 h-8 rounded bg-[#107c41] text-white inline-flex items-center justify-center mb-1">
                <span className="material-symbols-outlined text-[20px]">eco</span>
              </div>
              <h4 className="font-bold text-[16px] text-[#1a1c1c]">FreshBox Kiosk #08</h4>
              <p className="text-[11px] text-[#6f7a6f]">Tầng 1 - TTTM Central Mall</p>
              <p className="text-[11px] font-mono text-[#6f7a6f] mt-0.5">
                TX: FB-20261014-9412
              </p>
            </div>

            <div className="mt-3 text-[12px] space-y-1.5">
              <div className="flex justify-between text-[#6f7a6f]">
                <span>Thời gian:</span>
                <span className="font-mono text-[#1a1c1c]">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
              <div className="flex justify-between text-[#6f7a6f]">
                <span>Bảo quản:</span>
                <span className="font-semibold text-[#006130]">4°C Chiller Normal</span>
              </div>
              <div className="flex justify-between text-[#6f7a6f]">
                <span>Tiệt trùng:</span>
                <span className="font-semibold text-[#006130]">UV-C 254nm PASSED</span>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-dashed border-black/15 space-y-1 text-[12px]">
              {items.map(({ product, quantity }) => (
                <div key={product.id} className="flex justify-between">
                  <span className="truncate max-w-[140px]">
                    {quantity}x {isEn ? product.nameEn : product.name}
                  </span>
                  <span className="font-mono">
                    {(product.price * quantity).toLocaleString('vi-VN')}đ
                  </span>
                </div>
              ))}
              {discount > 0 && (
                <div className="flex justify-between text-[#006130]">
                  <span>Ưu đãi giờ vàng:</span>
                  <span className="font-mono">-{discount.toLocaleString('vi-VN')}đ</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-[14px] pt-1.5 border-t border-black/10">
                <span>Tổng cộng:</span>
                <span className="font-mono text-[#006130]">
                  {totalPaid.toLocaleString('vi-VN')}đ
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-dashed border-black/15 flex flex-col items-center text-center">
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://freshbox.vn/receipt/FB-20261014-9412"
              alt="QR Receipt"
              className="w-24 h-24 rounded border border-black/10 p-1 bg-white mb-2"
            />
            <p className="text-[11px] text-[#6f7a6f] max-w-[200px]">
              {t.eReceiptScan}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
