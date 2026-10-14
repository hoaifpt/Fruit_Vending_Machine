import { type FC, useState } from 'react';
import type { CartItem, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface CartPanelProps {
  items: CartItem[];
  language: Language;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
}

export const CartPanel: FC<CartPanelProps> = ({
  items,
  language,
  onUpdateQuantity,
  onClearCart,
  onProceedToCheckout
}) => {
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Calculate totals
  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );

  // Happy hour discount logic: 35,000 VND if subtotal > 100,000 VND
  const discount = subtotal >= 100000 ? 35000 : 0;
  const totalPayment = Math.max(0, subtotal - discount);

  return (
    <aside className="w-full lg:w-[32%] xl:w-[30%] flex flex-col">
      <div className="acrylic-layer rounded-[8px] border border-black/10 p-4 flex flex-col justify-between h-full bg-white/80 backdrop-blur-md shadow-xs">
        {/* Cart Header */}
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-black/8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[4px] bg-[#107c41] text-white flex items-center justify-center shadow-xs">
                <span className="material-symbols-outlined text-[18px]">
                  shopping_basket
                </span>
              </div>
              <h2 className="text-[18px] font-bold text-[#1a1c1c]">
                {t.yourCart}{' '}
                <span className="text-[#006130] font-normal text-[14px]">
                  ({items.length} {t.itemsCount})
                </span>
              </h2>
            </div>

            {items.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-8 h-8 rounded-[4px] flex items-center justify-center text-[#6f7a6f] hover:text-[#ba1a1a] hover:bg-[#ffdad6]/40 transition-colors cursor-pointer"
                title={t.emptyCartBtn}
              >
                <span className="material-symbols-outlined text-[18px]">
                  delete_sweep
                </span>
              </button>
            )}
          </div>

          {/* Modal / Inline Confirm for Clear Cart */}
          {showClearConfirm && (
            <div className="mt-2.5 p-2.5 bg-[#ffdad6]/40 border border-[#ba1a1a]/20 rounded-[6px] text-[12px] flex items-center justify-between">
              <span className="text-[#93000a] font-medium">
                {t.emptyCartConfirm}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2 py-0.5 rounded bg-white text-[#1a1c1c] border border-black/10 cursor-pointer"
                >
                  {isEn ? 'No' : 'Không'}
                </button>
                <button
                  onClick={() => {
                    onClearCart();
                    setShowClearConfirm(false);
                  }}
                  className="px-2 py-0.5 rounded bg-[#ba1a1a] text-white font-bold cursor-pointer"
                >
                  {isEn ? 'Yes' : 'Có'}
                </button>
              </div>
            </div>
          )}

          {/* Cart Item List */}
          {items.length === 0 ? (
            <div className="py-12 text-center text-[#6f7a6f]">
              <span className="material-symbols-outlined text-[44px] text-[#becabd] block mb-2">
                production_quantity_limits
              </span>
              <p className="text-[14px] font-medium">
                {isEn ? 'Your cart is empty' : 'Giỏ hàng đang trống'}
              </p>
              <p className="text-[12px] text-[#6f7a6f] mt-1">
                {isEn
                  ? 'Select freshly chilled fruit to add'
                  : 'Vui lòng chọn món trái cây bạn yêu thích'}
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {items.map(({ product, quantity }) => {
                const name = isEn ? product.nameEn : product.name;
                const portionNote = product.unit.replace('/ ', '');
                const lineTotal = product.price * quantity;

                return (
                  <div
                    key={product.id}
                    className="bg-white/95 rounded-[6px] p-2.5 border border-black/8 flex items-center justify-between shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-12 h-12 rounded-[4px] bg-[#f3f3f3] overflow-hidden shrink-0 border border-black/5">
                        <img
                          src={product.cartImage || product.image}
                          alt={name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <h4 className="text-[14px] font-bold text-[#1a1c1c] leading-snug line-clamp-1">
                          {name}
                        </h4>
                        <span className="text-[12px] text-[#6f7a6f] block">
                          {portionNote}
                        </span>
                        <span className="text-[14px] font-bold text-[#006130]">
                          {lineTotal.toLocaleString('vi-VN')}đ
                          {quantity > 1 && (
                            <span className="text-[11px] text-[#6f7a6f] font-normal ml-1">
                              ({quantity} {isEn ? 'units' : 'phần'})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Stepper Controls */}
                    <div className="flex items-center border border-black/15 rounded-[4px] overflow-hidden bg-[#f3f3f3]">
                      <button
                        onClick={() => onUpdateQuantity(product.id, -1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[#e2e2e2] text-[#1a1c1c] active:bg-[#dadada] transition-colors cursor-pointer"
                        title={quantity === 1 ? 'Xóa khỏi giỏ' : 'Giảm 1'}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {quantity === 1 ? 'delete' : 'remove'}
                        </span>
                      </button>
                      <span className="w-7 text-center font-bold text-[13px] text-[#1a1c1c] font-mono tabular-nums">
                        {quantity}
                      </span>
                      <button
                        onClick={() => onUpdateQuantity(product.id, 1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[#e2e2e2] text-[#1a1c1c] active:bg-[#dadada] transition-colors cursor-pointer"
                        title="Tăng 1"
                        disabled={quantity >= product.stock}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          add
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bill Breakdown & Dispense CTA */}
        <div className="mt-4 pt-3 border-t border-black/8">
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between text-[#3f4940]">
              <span>
                {t.subtotal} ({totalItemCount} {t.subtotalItems})
              </span>
              <span className="font-semibold text-[#1a1c1c] font-mono tabular-nums">
                {subtotal.toLocaleString('vi-VN')}đ
              </span>
            </div>

            {discount > 0 && (
              <div className="flex justify-between text-[#006130]">
                <span className="flex items-center gap-1 font-medium">
                  <span className="material-symbols-outlined text-[14px]">
                    local_offer
                  </span>
                  {t.happyHourPromo}
                </span>
                <span className="font-semibold font-mono tabular-nums">
                  - {discount.toLocaleString('vi-VN')}đ
                </span>
              </div>
            )}

            <div className="flex justify-between text-[#3f4940]">
              <span>{t.vatIncluded}</span>
              <span className="font-medium text-[#1a1c1c]">{t.includedText}</span>
            </div>

            <div className="flex justify-between items-baseline pt-2 border-t border-black/8">
              <span className="text-[14px] font-bold text-[#1a1c1c]">
                {t.totalPayment}
              </span>
              <span className="text-[22px] font-bold text-[#006130] tracking-tight font-mono tabular-nums">
                {totalPayment.toLocaleString('vi-VN')}đ
              </span>
            </div>
          </div>

          {/* Checkout CTA Button */}
          <button
            onClick={onProceedToCheckout}
            disabled={items.length === 0}
            className={`w-full mt-4 py-3.5 px-4 rounded-[6px] text-white flex items-center justify-center gap-2 font-bold text-[17px] tracking-wide transition-all shadow-sm ${
              items.length > 0
                ? 'fluent-btn-primary cursor-pointer hover:bg-[#0c6233]'
                : 'bg-[#becabd] cursor-not-allowed opacity-60'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">
              credit_card
            </span>
            <span>
              {t.checkoutButton} • {totalPayment.toLocaleString('vi-VN')}đ
            </span>
          </button>

          {/* Micro hardware security assurance note */}
          <div className="flex items-center justify-center gap-1.5 mt-2.5 text-[11px] text-[#6f7a6f] font-medium text-center">
            <span className="material-symbols-outlined text-[14px] text-[#006130]">
              lock
            </span>
            <span>{t.securityNote}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
