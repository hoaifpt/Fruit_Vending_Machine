/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import {
  type Product,
  type CartItem,
  type CategoryId,
  type KioskStep,
  type Language
} from './types';
import { INITIAL_PRODUCTS, INITIAL_CART_ITEMS } from './data/products';
import { Header } from './components/Header';
import { CatalogStep } from './components/CatalogStep';
import { PaymentStep } from './components/PaymentStep';
import { DispenseStep } from './components/DispenseStep';
import { FooterStepper } from './components/FooterStepper';
import { ProductDetailModal } from './components/ProductDetailModal';
import { TelemetryModal } from './components/TelemetryModal';
import { StaffModal } from './components/StaffModal';

export default function App() {
  const [currentStep, setCurrentStep] = useState<KioskStep>(1);
  const [products] = useState<Product[]>(INITIAL_PRODUCTS);
  const [cartItems, setCartItems] = useState<CartItem[]>(INITIAL_CART_ITEMS);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState<Language>('vi');

  // Modals
  const [inspectingProduct, setInspectingProduct] = useState<Product | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);

  // Cart operations
  const handleAddToCart = (product: Product, quantity = 1) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? {
                ...item,
                quantity: Math.min(product.stock, item.quantity + quantity)
              }
            : item
        );
      }
      return [...prev, { product, quantity: Math.min(product.stock, quantity) }];
    });
  };

  const handleUpdateCartQuantity = (productId: string, delta: number) => {
    setCartItems((prev) => {
      return prev
        .map((item) => {
          if (item.product.id === productId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const handleClearCart = () => {
    setCartItems([]);
  };

  const handleToggleLanguage = () => {
    setLanguage((prev) => (prev === 'vi' ? 'en' : 'vi'));
  };

  const handleProceedToCheckout = () => {
    if (cartItems.length > 0) {
      setCurrentStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePaymentSuccess = () => {
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFinishOrder = () => {
    setCartItems([]);
    setCurrentStep(1);
    setSelectedCategory('all');
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="fluent-mica min-h-screen flex flex-col font-['Hanken_Grotesk',sans-serif] text-[#1a1c1c] antialiased select-none">
      {/* Top Header */}
      <Header
        currentCategory={selectedCategory}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          if (currentStep !== 1) setCurrentStep(1);
        }}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          if (currentStep !== 1) setCurrentStep(1);
        }}
        language={language}
        onToggleLanguage={handleToggleLanguage}
        onOpenTelemetry={() => setShowTelemetry(true)}
      />

      {/* Main Touch Content Area */}
      <main className="flex-1 pt-26 sm:pt-28 pb-24 px-3 sm:px-6 flex flex-col justify-start">
        {currentStep === 1 && (
          <CatalogStep
            products={products}
            cartItems={cartItems}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            searchQuery={searchQuery}
            language={language}
            onAddToCart={handleAddToCart}
            onUpdateCartQuantity={handleUpdateCartQuantity}
            onClearCart={handleClearCart}
            onProceedToCheckout={handleProceedToCheckout}
            onViewProductDetails={(p) => setInspectingProduct(p)}
            onOpenTelemetry={() => setShowTelemetry(true)}
          />
        )}

        {currentStep === 2 && (
          <PaymentStep
            items={cartItems}
            language={language}
            onPaymentSuccess={handlePaymentSuccess}
            onBackToCatalog={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <DispenseStep
            items={cartItems}
            language={language}
            onFinishOrder={handleFinishOrder}
          />
        )}
      </main>

      {/* Bottom Kiosk Stepper Navigation */}
      <FooterStepper
        currentStep={currentStep}
        language={language}
        onStepChange={(s) => setCurrentStep(s)}
        onCallStaff={() => setShowStaffModal(true)}
        canNavigateToStep2={cartItems.length > 0}
      />

      {/* Product Detail Modal */}
      {inspectingProduct && (
        <ProductDetailModal
          product={inspectingProduct}
          language={language}
          onClose={() => setInspectingProduct(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {/* Cold Chain Diagnostics Telemetry Modal */}
      {showTelemetry && (
        <TelemetryModal
          language={language}
          onClose={() => setShowTelemetry(false)}
        />
      )}

      {/* Staff Call Assistance Modal */}
      {showStaffModal && (
        <StaffModal
          language={language}
          onClose={() => setShowStaffModal(false)}
        />
      )}
    </div>
  );
}
