export type CategoryId = 'all' | 'fresh' | 'cut' | 'juice' | 'combo';

export interface Product {
  id: string;
  name: string;
  nameEn: string;
  category: CategoryId;
  price: number;
  unit: string;
  unitEn: string;
  origin: string;
  originEn: string;
  tag: string;
  tagEn: string;
  tagType: 'primary' | 'tertiary' | 'secondary' | 'neutral';
  chillerBadge: string;
  chillerBadgeEn: string;
  stock: number;
  description: string;
  descriptionEn: string;
  image: string;
  cartImage?: string;
  brix?: number;
  calories?: number;
  temp?: number;
  packedTime?: string;
  lockerSlot?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export type KioskStep = 1 | 2 | 3;
export type Language = 'vi' | 'en';
export type PaymentMethod = 'vietqr' | 'card' | 'cash';
