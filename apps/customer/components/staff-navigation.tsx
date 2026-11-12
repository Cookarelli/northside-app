import Link from "next/link";
import { Tag, ClipboardList, Layers, LayoutDashboard } from "lucide-react";
import styles from "./staff-home.module.css";

export function StaffNavigation({
  current,
}: {
  current?: "home" | "requests" | "inquiry";
}) {
  return (
    <nav className={styles.navigation} aria-label="Staff workspace">
      <Link
        href="/staff"
        aria-current={current === "home" ? "page" : undefined}
      >
        <LayoutDashboard size={18} aria-hidden="true" /> Staff home
      </Link>
      <Link
        href="/staff/requests"
        aria-current={
          current === "requests"
            ? "page"
            : current === "inquiry"
              ? "location"
              : undefined
        }
      >
        <ClipboardList size={18} aria-hidden="true" /> Requests & follow-up
      </Link>
      <Link href="/staff/grading">
        <Layers size={18} aria-hidden="true" /> Grading cards
      </Link>
      <Link href="/staff/consignment">
        <Tag size={18} aria-hidden="true" /> Consignment cards
      </Link>
    </nav>
  );
}
