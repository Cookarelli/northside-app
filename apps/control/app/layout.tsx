import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Northside / Mission Control",
  description: "Supervised Northside App development",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
