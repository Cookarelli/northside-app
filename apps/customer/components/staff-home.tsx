import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  FilePlus2,
  Layers,
  Megaphone,
  Settings2,
  ShieldCheck,
  Store,
  Ticket,
  Users,
} from "lucide-react";
import { StaffNavigation } from "./staff-navigation";
import styles from "./staff-home.module.css";

const roleNames: Record<string, string> = {
  owner: "Store owner",
  admin: "Administrator",
  operations: "Operations",
  content_editor: "Content editor",
  read_only: "Read-only staff",
};
type StaffCard = {
  id: string;
  description: string;
  kind: string;
  status: string;
};

export function StaffHome({
  role,
  cards = [],
  signOut,
  adminTools,
  trainingTools,
  fixture = false,
}: {
  role: string;
  cards?: StaffCard[];
  signOut?: ReactNode;
  adminTools?: ReactNode;
  trainingTools?: ReactNode;
  fixture?: boolean;
}) {
  const canWorkRequests = ["owner", "admin", "operations"].includes(role);
  const canViewCards = canWorkRequests || role === "read_only";
  return (
    <section className={styles.home}>
      <div className={styles.topline}>
        <span className={styles.wordmark}>
          NORTHSIDE <span>/ STAFF</span>
        </span>
        <div className={styles.identity}>
          <span className={styles.role}>
            <ShieldCheck size={16} aria-hidden="true" />{" "}
            {roleNames[role] ?? "Staff"}
          </span>
          {signOut}
        </div>
      </div>
      {canViewCards ? <StaffNavigation current="home" /> : null}
      {fixture ? (
        <p className={styles.sample}>
          SAMPLE local workspace. No real messages, purchases or card receipt.
        </p>
      ) : null}
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>YOUR DAILY WORKSPACE</p>
          <h1>Northside Staff Dashboard</h1>
          <p>
            {canViewCards
              ? "Find a customer request, follow up, or work with cards already received. Everything has its own place."
              : "Your account is signed in. Request and card operations are not available to this staff role."}
          </p>
          {canViewCards ? (
            <div className={styles.heroActions}>
              <Link className={styles.primaryLight} href="/staff/requests">
                Open request queue
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              {canWorkRequests ? (
                <Link
                  className={styles.secondaryLight}
                  href="/staff/requests/new"
                >
                  <FilePlus2 size={18} aria-hidden="true" /> Record an inquiry
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={styles.heroGuide}>
          <ClipboardList size={28} aria-hidden="true" />
          <h2>
            {canViewCards
              ? "Requests first. Cards when received."
              : "Need another workspace?"}
          </h2>
          <p>
            {canViewCards
              ? "A submitted form starts a request. Physical intake is a separate step after staff receive the cards."
              : "Ask a Northside administrator which workspace is available for your role. Access is managed by the existing staff permissions."}
          </p>
        </div>
      </div>

      {canViewCards ? (
        <>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>START HERE</p>
              <h2>Customer services</h2>
            </div>
            <p>Choose the work you need to do.</p>
          </div>
          <div className={styles.serviceGrid}>
            <Link
              className={`${styles.actionCard} ${styles.featured}`}
              href="/staff/requests"
            >
              <span className={`${styles.icon} ${styles.blue}`}>
                <ClipboardList size={25} aria-hidden="true" />
              </span>
              <span className={styles.cardTitle}>Requests & follow-up</span>
              <span className={styles.cardText}>
                {canWorkRequests
                  ? "Review new inquiries, assign a staff owner and keep customers updated."
                  : "View inquiries, staff assignments and the dated request history."}
              </span>
              <span className={styles.cardAction}>
                Open request queue <ArrowRight size={18} aria-hidden="true" />
              </span>
            </Link>
            <Link className={styles.actionCard} href="/staff/grading">
              <span className={`${styles.icon} ${styles.teal}`}>
                <Layers size={25} aria-hidden="true" />
              </span>
              <span className={styles.cardTitle}>Grading cards</span>
              <span className={styles.cardText}>
                {canWorkRequests
                  ? "Work with received cards, private photos, quotes and grading progress."
                  : "View received cards, private photos, quotes and grading progress."}
              </span>
              <span className={styles.cardAction}>
                Open grading desk <ArrowRight size={18} aria-hidden="true" />
              </span>
            </Link>
            <Link className={styles.actionCard} href="/staff/consignment">
              <span className={`${styles.icon} ${styles.gold}`}>
                <Ticket size={25} aria-hidden="true" />
              </span>
              <span className={styles.cardTitle}>Consignment cards</span>
              <span className={styles.cardText}>
                {canWorkRequests
                  ? "Manage individual cards from acceptance and listing through settlement."
                  : "View individual cards from acceptance and listing through settlement."}
              </span>
              <span className={styles.cardAction}>
                Open consignment desk{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </span>
            </Link>
          </div>
          <div className={styles.receiptHint}>
            <ShieldCheck size={20} aria-hidden="true" />
            <p>
              <strong>Review is different from physical receipt.</strong> Use
              the request queue for Review and owner assignment. Card custody,
              such as “At Northside,” belongs in the card desks.
            </p>
          </div>
        </>
      ) : null}

      {canViewCards ? (
        <>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>MORE WORKSPACES</p>
              <h2>Keep the day moving</h2>
            </div>
          </div>
          <div className={styles.utilityGrid}>
            {canViewCards ? (
              <>
                <Link href="/staff/store">
                  <Store size={21} aria-hidden="true" />
                  <span>
                    <strong>Store workspace</strong>
                    <small>Store information and saved operations</small>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link href="/staff/breaks">
                  <Ticket size={21} aria-hidden="true" />
                  <span>
                    <strong>Break desk</strong>
                    <small>Saved events and participant work</small>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link href="/staff/rewards">
                  <Users size={21} aria-hidden="true" />
                  <span>
                    <strong>Rewards desk</strong>
                    <small>Customer loyalty records and reviews</small>
                  </span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </>
            ) : null}
            <Link href="/staff/engagement">
              <Megaphone size={21} aria-hidden="true" />
              <span>
                <strong>Engagement</strong>
                <small>Announcements and customer content</small>
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/staff/integrations" prefetch={false}>
              <Settings2 size={21} aria-hidden="true" />
              <span>
                <strong>Connection status</strong>
                <small>Check service setup and availability</small>
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </>
      ) : null}

      {canViewCards ? (
        <section className={styles.records}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>SAVED RECORDS</p>
              <h2>Consignment at a glance</h2>
            </div>
            <Link href="/staff/consignment">
              View consignment cards <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {cards.length ? (
            <ul className={styles.recordList}>
              {cards.map((card) => (
                <li key={card.id}>
                  <span>
                    <strong>{card.description}</strong>
                    <small>
                      Consignment · reference ending {card.id.slice(-8)}
                    </small>
                  </span>
                  <span className={styles.recordStatus}>{card.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              No consignment cards in this view. Open the grading or consignment
              desk to work with received cards.
            </p>
          )}
        </section>
      ) : null}

      {adminTools ? (
        <details className={styles.access}>
          <summary>
            <Users size={20} aria-hidden="true" /> Team & access{" "}
            <span>Manage staff invitations</span>
          </summary>
          {adminTools}
        </details>
      ) : null}
      {trainingTools ? (
        <details className={styles.access}>
          <summary>Local preview settings</summary>
          {trainingTools}
        </details>
      ) : null}
      <p className={styles.footnote}>
        Pre-launch workspace · Public purchases, rewards, scanning, aisle
        navigation and pickup remain disabled.
      </p>
    </section>
  );
}

export function StaffSignedOut() {
  return (
    <section className={styles.home}>
      <div className={styles.signInCard}>
        <span className={`${styles.icon} ${styles.blue}`}>
          <ShieldCheck size={28} aria-hidden="true" />
        </span>
        <p className={styles.eyebrow}>NORTHSIDE STAFF</p>
        <h1>Your workspace is ready.</h1>
        <p>
          Sign in with your invited staff account to open requests, follow-ups
          and card operations.
        </p>
        <Link className={styles.primary} href="/staff/login">
          Continue to staff sign-in <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
