import type { Metadata } from "next";
import "./in-store.css";
export const metadata: Metadata = {
  title: "In-store rehearsal · Northside",
  description:
    "Local fixture shopping and counter handoff rehearsal. No real charges.",
};
export default function InStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
