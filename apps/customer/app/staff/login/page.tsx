import { authReadiness } from "@/lib/server/providers";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { StaffAuthForm } from "@/components/staff-auth-form";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import styles from "@/components/staff-home.module.css";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string }>;
}) {
  const ready = authReadiness().staff && !fixturesAllowed(process.env);
  const { requested } = await searchParams;
  return (
    <section className={styles.home}>
      <div className={styles.signInCard}>
        <Link className={styles.backLink} href="/">
          {" "}
          <ArrowLeft size={16} aria-hidden="true" /> Northside home
        </Link>
        <div className={`${styles.icon} ${styles.blue}`}>
          <ShieldCheck size={27} aria-hidden="true" />
        </div>
        <p className={styles.eyebrow}>INVITED STAFF ONLY</p>
        <h1>Staff sign-in</h1>
        <p>
          Use your invited staff email to open requests, follow-ups and card
          operations. We’ll email a secure sign-in link.
        </p>
        {requested && (
          <p className={styles.sample} role="status">
            If your address belongs to an invited account, check your email for
            the sign-in link. Delivery is not confirmed here.
          </p>
        )}
        <StaffAuthForm step="request" disabled={!ready}>
          <label>
            Staff email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@northsidecollectibles.com"
              required
              disabled={!ready}
            />
          </label>
        </StaffAuthForm>
        {!ready && (
          <p className={styles.sample}>
            Real staff authentication is not configured for this preview. No
            invitation or email will be sent.
          </p>
        )}
        <p className={styles.signInHelp}>
          Looking for your own cards?{" "}
          <Link href="/account">Use customer sign-in</Link>.
        </p>
      </div>
    </section>
  );
}
