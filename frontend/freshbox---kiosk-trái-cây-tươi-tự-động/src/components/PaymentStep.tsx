import { type FC, useState, useEffect } from 'react';
import type { CartItem, PaymentMethod, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface PaymentStepProps {
  items: CartItem[];
  language: Language;
  onPaymentSuccess: () => void;
  onBackToCatalog: () => void;
}

export const PaymentStep: FC<PaymentStepProps> = ({
  items,
  language,
  onPaymentSuccess,
  onBackToCatalog
}) => {
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('vietqr');
  const [countdown, setCountdown] = useState(300); // 5 minutes
  const [cashInserted, setCashInserted] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [wantsInvoice, setWantsInvoice] = useState(false);

  // Totals
  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const discount = subtotal >= 100000 ? 35000 : 0;
  const totalAmount = Math.max(0, subtotal - discount);

  // Countdown timer for QR
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSimulatePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      onPaymentSuccess();
    }, 1200);
  };

  const handleInsertCash = (amount: number) => {
    const nextVal = cashInserted + amount;
    setCashInserted(nextVal);
    if (nextVal >= totalAmount) {
      setTimeout(() => {
        setIsProcessing(true);
        setTimeout(() => {
          setIsProcessing(false);
          onPaymentSuccess();
        }, 1200);
      }, 700);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 max-w-[1920px] mx-auto w-full">
      {/* LEFT AREA: Payment Options & Interactive Readers */}
      <div className="flex-1 bg-white rounded-[8px] border border-black/10 p-5 sm:p-7 shadow-xs flex flex-col justify-between">
        <div>
          {/* Back button & Title */}
          <div className="flex items-center justify-between pb-4 border-b border-black/8">
            <button
              onClick={onBackToCatalog}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f3f3f3] hover:bg-[#e8e8e8] text-[#1a1c1c] rounded-[4px] text-[13px] font-semibold transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">
                arrow_back
              </span>
              <span>{t.backToCatalog}</span>
            </button>

            <div className="text-right">
              <span className="text-[12px] text-[#6f7a6f] block">
                {isEn ? 'Amount to Pay' : 'Số tiền thanh toán'}
              </span>
              <span className="text-[24px] font-bold text-[#006130] font-mono tabular-nums">
                {totalAmount.toLocaleString('vi-VN')}đ
              </span>
            </div>
          </div>

          {/* Payment Method Selector Tabs */}
          <div className="grid grid-cols-3 gap-2.5 mt-5">
            <button
              onClick={() => setSelectedMethod('vietqr')}
              className={`p-3 rounded-[6px] border text-left transition-all cursor-pointer ${
                selectedMethod === 'vietqr'
                  ? 'border-[#006130] bg-[#8af5be]/15 text-[#006130] shadow-xs ring-1 ring-[#006130]'
                  : 'border-black/10 bg-[#f9f9f9] hover:bg-[#eeeeee] text-[#1a1c1c]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="material-symbols-outlined text-[24px]">
                  qr_code_2
                </span>
                {selectedMethod === 'vietqr' && (
                  <span className="material-symbols-outlined text-[16px] text-[#006130]">
                    check_circle
                  </span>
                )}
              </div>
              <div className="font-bold text-[14px] leading-tight">
                {t.vietqrTab}
              </div>
              <div className="text-[11px] text-[#6f7a6f] mt-0.5">
                MoMo / ZaloPay / Banking
              </div>
            </button>

            <button
              onClick={() => setSelectedMethod('card')}
              className={`p-3 rounded-[6px] border text-left transition-all cursor-pointer ${
                selectedMethod === 'card'
                  ? 'border-[#006130] bg-[#8af5be]/15 text-[#006130] shadow-xs ring-1 ring-[#006130]'
                  : 'border-black/10 bg-[#f9f9f9] hover:bg-[#eeeeee] text-[#1a1c1c]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="material-symbols-outlined text-[24px]">
                  contactless
                </span>
                {selectedMethod === 'card' && (
                  <span className="material-symbols-outlined text-[16px] text-[#006130]">
                    check_circle
                  </span>
                )}
              </div>
              <div className="font-bold text-[14px] leading-tight">
                {t.cardTab}
              </div>
              <div className="text-[11px] text-[#6f7a6f] mt-0.5">
                Napas / Visa / Apple Pay
              </div>
            </button>

            <button
              onClick={() => setSelectedMethod('cash')}
              className={`p-3 rounded-[6px] border text-left transition-all cursor-pointer ${
                selectedMethod === 'cash'
                  ? 'border-[#006130] bg-[#8af5be]/15 text-[#006130] shadow-xs ring-1 ring-[#006130]'
                  : 'border-black/10 bg-[#f9f9f9] hover:bg-[#eeeeee] text-[#1a1c1c]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="material-symbols-outlined text-[24px]">
                  payments
                </span>
                {selectedMethod === 'cash' && (
                  <span className="material-symbols-outlined text-[16px] text-[#006130]">
                    check_circle
                  </span>
                )}
              </div>
              <div className="font-bold text-[14px] leading-tight">
                {t.cashTab}
              </div>
              <div className="text-[11px] text-[#6f7a6f] mt-0.5">
                {isEn ? 'Banknotes accepted' : 'Nhận tiền giấy tự động'}
              </div>
            </button>
          </div>

          {/* Dynamic Content Panel based on Selected Method */}
          <div className="mt-6 p-6 rounded-[8px] bg-[#f9f9f9] border border-black/8 min-h-[300px] flex flex-col items-center justify-center text-center">
            {selectedMethod === 'vietqr' && (
              <div className="flex flex-col items-center max-w-sm">
                <div className="relative p-3 bg-white rounded-[6px] border border-black/10 shadow-xs mb-3">
                  {/* Dynamic VietQR code mockup image with realistic layout */}
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=00020101021238540010A00000072701240006970422011009876543210208QRIBFTTA520460115303704540${totalAmount}5802VN62180814KIOSK08TX94126304FB76`}
                    alt="VietQR Payment Code"
                    className="w-48 h-48 rounded"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-10 h-10 bg-white rounded p-1 shadow-md border border-black/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[22px] text-[#006130]">
                        eco
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-[14px] font-semibold text-[#1a1c1c]">
                  {t.scanQrPrompt}
                </p>
                <div className="flex items-center gap-1.5 mt-2 text-[13px] text-[#3f4940]">
                  <span>{t.qrExpiresIn}</span>
                  <span className="font-mono font-bold text-[#ba1a1a]">
                    {formatTime(countdown)}
                  </span>
                </div>

                {/* Fast simulation button */}
                <button
                  onClick={handleSimulatePayment}
                  disabled={isProcessing}
                  className="mt-4 px-4 py-2.5 bg-[#107c41] hover:bg-[#0c6233] text-white rounded-[6px] font-bold text-[13px] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    check_circle
                  </span>
                  <span>{isProcessing ? 'Đang xử lý...' : t.simulateSuccessBtn}</span>
                </button>
              </div>
            )}

            {selectedMethod === 'card' && (
              <div className="flex flex-col items-center max-w-sm">
                <div className="w-24 h-24 rounded-full bg-[#107c41]/10 flex items-center justify-center text-[#107c41] mb-4 animate-pulse">
                  <span className="material-symbols-outlined text-[48px]">
                    contactless
                  </span>
                </div>

                <h3 className="text-[17px] font-bold text-[#1a1c1c]">
                  {isEn ? 'Ready for Contactless Tap' : 'Đang chờ chạm thẻ / POS'}
                </h3>
                <p className="text-[13px] text-[#6f7a6f] mt-1.5 max-w-xs">
                  {t.nfcPrompt}
                </p>

                <div className="flex items-center gap-3 mt-4 text-[12px] font-semibold text-[#3f4940]">
                  <span className="px-2 py-1 bg-white rounded border border-black/10">
                    NAPAS
                  </span>
                  <span className="px-2 py-1 bg-white rounded border border-black/10">
                    VISA
                  </span>
                  <span className="px-2 py-1 bg-white rounded border border-black/10">
                    MASTERCARD
                  </span>
                  <span className="px-2 py-1 bg-white rounded border border-black/10">
                    APPLE PAY
                  </span>
                </div>

                <button
                  onClick={handleSimulatePayment}
                  disabled={isProcessing}
                  className="mt-5 px-4 py-2.5 bg-[#107c41] hover:bg-[#0c6233] text-white rounded-[6px] font-bold text-[13px] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    credit_card
                  </span>
                  <span>{isProcessing ? 'Đang xác thực thẻ...' : t.simulateNfcBtn}</span>
                </button>
              </div>
            )}

            {selectedMethod === 'cash' && (
              <div className="flex flex-col items-center w-full max-w-md">
                <div className="w-full bg-[#eeeeee] p-4 rounded-[6px] border border-black/10 mb-4 text-left">
                  <div className="flex justify-between text-[13px] mb-1">
                    <span className="text-[#6f7a6f]">{t.cashInserted}</span>
                    <span className="font-mono font-bold text-[#006130] text-[16px]">
                      {cashInserted.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  <div className="flex justify-between text-[13px] mb-1">
                    <span className="text-[#6f7a6f]">{t.cashRemaining}</span>
                    <span className="font-mono font-bold text-[#ba1a1a]">
                      {Math.max(0, totalAmount - cashInserted).toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  {cashInserted > totalAmount && (
                    <div className="flex justify-between text-[13px] text-[#006130] pt-1 border-t border-black/10">
                      <span className="font-semibold">{t.cashChange}</span>
                      <span className="font-mono font-bold">
                        {(cashInserted - totalAmount).toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-[13px] text-[#6f7a6f] mb-3">
                  {t.cashPrompt}
                </p>

                {/* Banknotes simulation */}
                <div className="grid grid-cols-3 gap-2 w-full">
                  {[20000, 50000, 100000, 200000].map((val) => (
                    <button
                      key={val}
                      onClick={() => handleInsertCash(val)}
                      className="py-2.5 px-3 bg-white hover:bg-[#eeeeee] border border-black/15 rounded-[4px] font-mono font-bold text-[13px] text-[#1a1c1c] transition-colors cursor-pointer active:scale-95"
                    >
                      +{val.toLocaleString('vi-VN')}đ
                    </button>
                  ))}
                  <button
                    onClick={() => handleInsertCash(500000)}
                    className="py-2.5 px-3 bg-[#8af5be]/30 hover:bg-[#8af5be]/50 border border-[#006130]/30 rounded-[4px] font-mono font-bold text-[13px] text-[#006130] transition-colors cursor-pointer active:scale-95 col-span-2"
                  >
                    +500.000đ ({isEn ? 'Simulate 500k note' : 'Nạp tờ 500.000đ'})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* E-Invoice Toggle */}
        <div className="mt-6 pt-4 border-t border-black/8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#1a1c1c]">
            <input
              type="checkbox"
              checked={wantsInvoice}
              onChange={(e) => setWantsInvoice(e.target.checked)}
              className="w-4 h-4 rounded text-[#006130] focus:ring-[#006130]"
            />
            <span className="font-medium">
              {isEn ? 'Issue electronic VAT invoice' : 'Xuất hóa đơn điện tử VAT qua Zalo/Email'}
            </span>
          </label>

          {wantsInvoice && (
            <input
              type="tel"
              placeholder={isEn ? 'Phone number (e.g. 0901234567)' : 'Số điện thoại nhận hóa đơn...'}
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="px-3 py-1.5 bg-[#f3f3f3] border border-black/10 rounded-[4px] text-[13px] w-full sm:w-60 focus:bg-white focus:outline-none focus:border-[#006130]"
            />
          )}
        </div>
      </div>

      {/* RIGHT AREA: Order Summary Breakdown */}
      <aside className="w-full lg:w-[32%] xl:w-[30%] flex flex-col">
        <div className="acrylic-layer rounded-[8px] border border-black/10 p-5 bg-white/80 backdrop-blur-md shadow-xs flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-black/8">
              <h3 className="text-[16px] font-bold text-[#1a1c1c]">
                {isEn ? 'Order Review' : 'Tóm tắt đơn hàng'}
              </h3>
              <span className="text-[12px] font-semibold text-[#006130] bg-[#8af5be]/30 px-2 py-0.5 rounded-[4px]">
                Kiosk #08
              </span>
            </div>

            <div className="mt-3 space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {items.map(({ product, quantity }) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between text-[13px] py-1 border-b border-black/5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#006130] w-5">
                      {quantity}x
                    </span>
                    <span className="text-[#1a1c1c] font-medium truncate max-w-[170px]">
                      {isEn ? product.nameEn : product.name}
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-[#1a1c1c]">
                    {(product.price * quantity).toLocaleString('vi-VN')}đ
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-3 border-t border-black/8 space-y-1.5 text-[13px]">
            <div className="flex justify-between text-[#3f4940]">
              <span>{t.subtotal}</span>
              <span className="font-mono">{subtotal.toLocaleString('vi-VN')}đ</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-[#006130] font-medium">
                <span>{t.happyHourPromo}</span>
                <span className="font-mono">-{discount.toLocaleString('vi-VN')}đ</span>
              </div>
            )}
            <div className="flex justify-between text-[#3f4940]">
              <span>{t.vatIncluded}</span>
              <span>{t.includedText}</span>
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-black/8 text-[15px] font-bold text-[#1a1c1c]">
              <span>{t.totalPayment}</span>
              <span className="text-[20px] font-mono text-[#006130]">
                {totalAmount.toLocaleString('vi-VN')}đ
              </span>
            </div>

            <div className="mt-4 p-3 bg-[#f3f3f3] rounded-[6px] text-[11px] text-[#6f7a6f] flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] text-[#006130] shrink-0 mt-0.5">
                shield_with_heart
              </span>
              <span>
                {isEn
                  ? 'Your transaction is encrypted and certified with 100% money-back guarantee if dispenser fails.'
                  : 'Giao dịch bảo mật 100%. Cam kết hoàn tiền ngay lập tức nếu khoang trả hàng gặp sự cố.'}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
