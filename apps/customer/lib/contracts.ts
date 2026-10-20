export type Product = {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  accent: string;
  description: string;
};
export type TimelineEvent = {
  label: string;
  at: string | null;
  source: "staff fixture";
  complete: boolean;
};
export type CardCase = {
  id: string;
  name: string;
  status: string;
  events: TimelineEvent[];
};
export type BreakEvent = {
  id: string;
  title: string;
  startsAt: string;
  status: "scheduled";
  format: string;
};
export type Tier = {
  name: "Rookie" | "Vet" | "HOF" | "GOAT";
  threshold: number;
};
export type Wallet = {
  points: number;
  held: number;
  tier: string;
  tiers: Tier[];
  rulesActive: false;
};
export interface CommerceService {
  catalog(): Promise<Product[]>;
  checkout(): Promise<never>;
}
export interface CustomerService {
  previewIdentity(): Promise<{ name: string; fixture: true } | null>;
}
export interface GradingService {
  cases(): Promise<CardCase[]>;
}
export interface ConsignmentService {
  cases(): Promise<CardCase[]>;
  capabilities: { providerFeed: false; payouts: false };
}
export interface BreaksService {
  schedule(): Promise<BreakEvent[]>;
}
export interface NorthsideLoyaltyService {
  wallet(): Promise<Wallet | null>;
  redeem(): Promise<never>;
}
export type Services = {
  commerce: CommerceService;
  customer: CustomerService;
  grading: GradingService;
  consignment: ConsignmentService;
  breaks: BreaksService;
  loyalty: NorthsideLoyaltyService;
};
export type PreviewData = {
  fixture: boolean;
  products: Product[];
  identity: { name: string; fixture: true } | null;
  grading: CardCase[];
  consignment: CardCase[];
  breaks: BreakEvent[];
  wallet: Wallet | null;
};
