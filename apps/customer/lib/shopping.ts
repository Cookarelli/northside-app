export type ShoppingLine = {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  image: { url: string; altText: string | null } | null;
  quantity: number;
  priceCents: number;
};
export type ShoppingCart = {
  version: number;
  sample: boolean;
  phase: "shopping" | "ready_for_staff";
  lines: ShoppingLine[];
  subtotalCents: number;
  currency: "USD";
  paymentStatus: "unpaid";
  handoff: { reference: string; expiresAt: number } | null;
};
export type ShoppingResponse = ShoppingCart & { qr?: string };
