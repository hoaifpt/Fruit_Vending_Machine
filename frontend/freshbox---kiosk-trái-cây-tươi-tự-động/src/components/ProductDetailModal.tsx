import { type FC, useState } from 'react';
import type { Product, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface ProductDetailModalProps {
  product: Product;
  language: Language;
  onClose: () => void;
  onAddToCart: (product: Product, quantity: number) => void;
}

export const ProductDetailModal: FC<ProductDetailModalProps> = ({
  product,
  language,
  onClose,
  onAddToCart
}) => {
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';
  const [qty, setQty] = useState(1);

  const name = isEn ? product.nameEn : product.name;
  const description = isEn ? product.descriptionEn : product.description;
  const origin = isEn ? product.originEn : product.origin;
  const unit = isEn ? product.unitEn : product.unit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-[8px] border border-black/10 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/8 bg-[#f9f9f9]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#006130]">
              verified
            </span>
            <span className="font-bold text-[14px] text-[#1a1c1c]">
              {t.detailsTitle}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-[#6f7a6f] hover:text-[#1a1c1c] hover:bg-[#eeeeee] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Image & Quick Badges */}
          <div className="relative w-full h-48 bg-[#f3f3f3] rounded-[6px] overflow-hidden">
            <img
              src={product.image}
              alt={name}
              className="w-full h-full object-cover"
            />
            <div className="absolute top-2 left-2 px-2.5 py-0.5 bg-[#107c41] text-white text-[11px] font-bold rounded tracking-wide uppercase">
              {isEn ? product.tagEn : product.tag}
            </div>
            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-white/90 backdrop-blur-xs text-[#1a1c1c] text-[11px] font-semibold rounded border border-black/10">
              {product.chillerBadge}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center text-[13px] text-[#6f7a6f]">
              <span>{origin}</span>
              <span className="font-bold text-[#006130]">
                {t.stockLabel}: {product.stock}
              </span>
            </div>
            <h2 className="text-[20px] font-bold text-[#1a1c1c] mt-0.5">
              {name}
            </h2>
            <p className="text-[14px] text-[#3f4940] mt-1">{description}</p>
          </div>

          {/* Sensory & Nutrition Specs Grid */}
          <div className="grid grid-cols-2 gap-2.5 p-3.5 bg-[#f3f3f3] rounded-[6px] border border-black/8 text-[13px]">
            <div>
              <span className="text-[#6f7a6f] text-[11px] block">{t.sweetness}</span>
              <span className="font-bold text-[#1a1c1c]">
                {product.brix ? `${product.brix}° Brix` : '12° - 14° Brix'}
              </span>
            </div>
            <div>
              <span className="text-[#6f7a6f] text-[11px] block">{t.calories}</span>
              <span className="font-bold text-[#1a1c1c]">
                ~{product.calories || 110} Kcal
              </span>
            </div>
            <div>
              <span className="text-[#6f7a6f] text-[11px] block">{t.harvestDate}</span>
              <span className="font-bold text-[#006130]">
                {product.packedTime || '06:00 AM'}
              </span>
            </div>
            <div>
              <span className="text-[#6f7a6f] text-[11px] block">Khoang tủ Kiosk</span>
              <span className="font-bold text-[#1a1c1c] font-mono">
                {product.lockerSlot || 'A-01'}
              </span>
            </div>
          </div>

          {/* UV-C Sanitization Banner */}
          <div className="p-3 bg-[#8af5be]/20 rounded-[6px] border border-[#8af5be] flex items-start gap-2.5 text-[12px]">
            <span className="material-symbols-outlined text-[18px] text-[#006130] shrink-0 mt-0.5">
              sanitizer
            </span>
            <div>
              <span className="font-bold text-[#005235] block">{t.uvcStatus}</span>
              <span className="text-[#005235]/90">{t.uvcStatusDesc}</span>
            </div>
          </div>
        </div>

        {/* Modal Footer: Quantity Stepper & Add CTA */}
        <div className="p-4 border-t border-black/8 bg-[#f9f9f9] flex items-center justify-between gap-4">
          <div>
            <span className="text-[20px] font-bold text-[#006130] tracking-tight font-mono">
              {(product.price * qty).toLocaleString('vi-VN')}đ
            </span>
            <span className="text-[12px] text-[#6f7a6f] block">{unit}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Quantity Stepper */}
            <div className="flex items-center border border-black/15 rounded-[4px] overflow-hidden bg-white">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-8 h-8 flex items-center justify-center hover:bg-[#eeeeee] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">remove</span>
              </button>
              <span className="w-8 text-center font-bold text-[14px] font-mono">
                {qty}
              </span>
              <button
                onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                className="w-8 h-8 flex items-center justify-center hover:bg-[#eeeeee] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
              </button>
            </div>

            <button
              onClick={() => {
                onAddToCart(product, qty);
                onClose();
              }}
              className="px-5 py-2.5 bg-[#107c41] hover:bg-[#0c6233] text-white rounded-[4px] font-bold text-[14px] flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">
                shopping_cart
              </span>
              <span>{t.addToCart}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
