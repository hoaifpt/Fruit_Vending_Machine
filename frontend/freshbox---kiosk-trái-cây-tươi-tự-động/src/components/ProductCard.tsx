import type { FC } from 'react';
import type { Product, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';

interface ProductCardProps {
  product: Product;
  language: Language;
  onAddToCart: (product: Product) => void;
  onViewDetails: (product: Product) => void;
}

export const ProductCard: FC<ProductCardProps> = ({
  product,
  language,
  onAddToCart,
  onViewDetails
}) => {
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';

  const name = isEn ? product.nameEn : product.name;
  const origin = isEn ? product.originEn : product.origin;
  const tag = isEn ? product.tagEn : product.tag;
  const description = isEn ? product.descriptionEn : product.description;
  const unit = isEn ? product.unitEn : product.unit;
  const chillerBadge = isEn ? product.chillerBadgeEn : product.chillerBadge;

  // Tag styling based on tagType
  const getTagStyle = () => {
    switch (product.tagType) {
      case 'primary':
        return 'bg-[#107c41] text-white';
      case 'tertiary':
        return 'bg-[#007c46] text-[#b3ffc9]';
      case 'secondary':
        return 'bg-[#8af5be] text-[#005235]';
      case 'neutral':
      default:
        return 'bg-[#e2e2e2] text-[#1a1c1c]';
    }
  };

  const formattedPrice = product.price.toLocaleString('vi-VN') + 'đ';

  return (
    <div
      onClick={() => onViewDetails(product)}
      className="fluent-card rounded-[8px] p-3 flex flex-col justify-between transition-all duration-150 relative group cursor-pointer hover:border-[#107c41]/50 bg-white"
    >
      <div>
        {/* Product Image Box */}
        <div className="relative w-full h-36 bg-[#f3f3f3] rounded-[6px] overflow-hidden mb-2.5">
          <img
            src={product.image}
            alt={name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
          {/* Top Left Badge */}
          <div
            className={`absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold rounded-[4px] tracking-wide uppercase shadow-xs ${getTagStyle()}`}
          >
            {tag}
          </div>
          {/* Bottom Right Chiller / Metric Badge */}
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-white/90 backdrop-blur-xs text-[#1a1c1c] text-[11px] font-medium rounded-[4px] border border-black/10">
            {chillerBadge}
          </div>
        </div>

        {/* Product Info */}
        <div>
          <div className="flex items-center justify-between text-[12px] gap-1">
            <span className="text-[#6f7a6f] truncate">{origin}</span>
            <span className="text-[#006130] font-bold shrink-0">
              {t.stockLabel}: {product.stock}
            </span>
          </div>

          <h3 className="text-[17px] font-semibold text-[#1a1c1c] truncate mt-0.5 group-hover:text-[#006130] transition-colors">
            {name}
          </h3>
          <p className="text-[13px] text-[#3f4940] line-clamp-1 mt-0.5">
            {description}
          </p>
        </div>
      </div>

      {/* Card Footer: Price & Add Button */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-black/8">
        <div>
          <span className="text-[19px] text-[#006130] font-bold tracking-tight">
            {formattedPrice}
          </span>
          <span className="text-[12px] text-[#6f7a6f] block">{unit}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart(product);
          }}
          className="w-11 h-11 bg-[#006130] hover:bg-[#007c46] active:bg-[#0c6233] text-white rounded-[6px] flex items-center justify-center active:scale-95 transition-all shadow-xs cursor-pointer"
          title={isEn ? 'Add to cart' : 'Thêm vào giỏ hàng'}
        >
          <span className="material-symbols-outlined text-[22px]">add</span>
        </button>
      </div>
    </div>
  );
};
