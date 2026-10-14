import type { FC } from 'react';
import type { Product, CartItem, CategoryId, Language } from '../types';
import { TRANSLATIONS } from '../data/translations';
import { ProductCard } from './ProductCard';
import { CartPanel } from './CartPanel';

interface CatalogStepProps {
  products: Product[];
  cartItems: CartItem[];
  selectedCategory: CategoryId;
  onSelectCategory: (category: CategoryId) => void;
  searchQuery: string;
  language: Language;
  onAddToCart: (product: Product) => void;
  onUpdateCartQuantity: (productId: string, delta: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
  onViewProductDetails: (product: Product) => void;
  onOpenTelemetry: () => void;
}

export const CatalogStep: FC<CatalogStepProps> = ({
  products,
  cartItems,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  language,
  onAddToCart,
  onUpdateCartQuantity,
  onClearCart,
  onProceedToCheckout,
  onViewProductDetails,
  onOpenTelemetry
}) => {
  const t = TRANSLATIONS[language];

  // Category filter tabs
  const filterTabs: { id: CategoryId; label: string; count?: number }[] = [
    { id: 'all', label: t.tabAll },
    { id: 'fresh', label: t.tabFresh },
    { id: 'cut', label: t.tabCut },
    { id: 'juice', label: t.tabJuice },
    { id: 'combo', label: t.tabCombo }
  ];

  // Filter products based on active category and search
  const filteredProducts = products.filter((p) => {
    const matchesCategory =
      selectedCategory === 'all' || p.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      p.nameEn.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.origin.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-5 max-w-[1920px] mx-auto w-full">
      {/* LEFT SECTION (70% WIDTH) - PRODUCT CATALOG & BANNERS */}
      <section className="w-full lg:w-[68%] xl:w-[70%] flex flex-col gap-4">
        {/* BANNER STRIP - VietGAP & Cold-chain Assurance */}
        <div
          onClick={onOpenTelemetry}
          className="relative overflow-hidden rounded-[8px] border border-black/10 bg-white p-4 sm:p-5 flex items-center justify-between shadow-2xs cursor-pointer hover:border-[#107c41]/50 transition-colors group"
        >
          <div className="z-10 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] bg-[#8af5be] text-[#005235] text-[12px] font-bold mb-2">
              <span className="material-symbols-outlined text-[14px]">
                verified
              </span>
              <span>{t.bannerBadge}</span>
            </div>
            <h2 className="text-[20px] sm:text-[22px] text-[#1a1c1c] font-bold tracking-tight">
              {t.bannerTitle}
            </h2>
            <p className="text-[13px] sm:text-[14px] text-[#3f4940] mt-1 leading-relaxed">
              {t.bannerDesc}
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-4 z-10 shrink-0 ml-4">
            <div className="text-right">
              <span className="text-[12px] text-[#6f7a6f] block">
                {t.bannerUpdateLabel}
              </span>
              <span className="text-[14px] font-bold text-[#006130]">
                {t.bannerUpdateTime}
              </span>
            </div>
            <div className="w-12 h-12 bg-[#006130]/10 group-hover:bg-[#006130]/20 transition-colors rounded-[6px] flex items-center justify-center text-[#006130]">
              <span className="material-symbols-outlined text-[28px]">
                ac_unit
              </span>
            </div>
          </div>

          {/* Subtle gradient overlay */}
          <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#8af5be]/15 to-transparent pointer-events-none" />
        </div>

        {/* CATEGORY CHIP BAR (Rectangular 4px border radius) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {filterTabs.map((tab) => {
            const isActive = selectedCategory === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectCategory(tab.id)}
                className={`px-4 py-2 rounded-[4px] text-[14px] whitespace-nowrap transition-all cursor-pointer font-semibold ${
                  isActive
                    ? 'bg-white text-[#006130] border-b-2 border-[#006130] shadow-xs'
                    : 'bg-[#f3f3f3] hover:bg-[#eeeeee] text-[#3f4940] border border-black/8 font-medium'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* FRUIT MATRIX / BENTO GRID */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-[8px] border border-black/8 p-12 text-center text-[#6f7a6f]">
            <span className="material-symbols-outlined text-[48px] text-[#becabd] block mb-2">
              search_off
            </span>
            <p className="text-[16px] font-semibold text-[#1a1c1c]">
              {language === 'vi'
                ? 'Không tìm thấy sản phẩm nào'
                : 'No products matched your search'}
            </p>
            <p className="text-[13px] text-[#6f7a6f] mt-1">
              {language === 'vi'
                ? 'Vui lòng thử tìm kiếm với từ khóa khác hoặc chọn mục Tất cả'
                : 'Try searching with another keyword or select All'}
            </p>
            <button
              onClick={() => onSelectCategory('all')}
              className="mt-4 px-4 py-2 bg-[#006130] text-white rounded-[4px] font-bold text-[13px] cursor-pointer"
            >
              {language === 'vi' ? 'Xem tất cả sản phẩm' : 'View all products'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                language={language}
                onAddToCart={onAddToCart}
                onViewDetails={onViewProductDetails}
              />
            ))}
          </div>
        )}
      </section>

      {/* RIGHT SECTION (30% WIDTH) - FLOATING ACRYLIC CART PANEL */}
      <CartPanel
        items={cartItems}
        language={language}
        onUpdateQuantity={onUpdateCartQuantity}
        onClearCart={onClearCart}
        onProceedToCheckout={onProceedToCheckout}
      />
    </div>
  );
};
