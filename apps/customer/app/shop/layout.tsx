import type { Viewport } from "next";
export const viewport: Viewport = {
  themeColor: "#071526",
  viewportFit: "cover",
};
export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
