import type { Metadata } from "next";
import "./in-store.css";
export const metadata: Metadata = {
  title: "In-store · Northside",
  description:
    "Northside in-store shopping preparation and local transaction rehearsal.",
};
export default function InStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
