"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Star } from "lucide-react";
import type { LoyaltyWallet } from "@/lib/loyalty";

type Result = { key: string } & (
  { state: "guest" | "error" } | { state: "loaded"; wallet: LoyaltyWallet }
);

export function HomeLoyalty({ sample }: { sample: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const endpoint = sample
    ? "/api/preview/loyalty?actor=a"
    : "/api/private/loyalty";
  const key = `${endpoint}:${attempt}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403)
          return { key, state: "guest" } as const;
        if (!response.ok) throw Error();
        const wallet: LoyaltyWallet = await response.json();
        if (
          !["not_launched", "not_enrolled", "ready"].includes(wallet.state) ||
          (wallet.state === "ready" && !Number.isSafeInteger(wallet.balance))
        )
          throw Error();
        return { key, state: "loaded", wallet } as const;
      })
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, state: "error" });
      });
    return () => controller.abort();
  }, [endpoint, key]);

  const wallet = current?.state === "loaded" ? current.wallet : null;
  return (
    <section className="ns-content ns-loyalty" aria-labelledby="loyalty-title">
      <div className="ns-loyalty-mark" aria-hidden="true">
        <Star size={30} />
      </div>
      <div className="ns-loyalty-intro">
        <p className="ns-kicker">
          {sample ? "SAMPLE WALLET · LOCAL ONLY" : "NORTHSIDE REWARDS"}
        </p>
        <h2 id="loyalty-title">Your hobby has its perks.</h2>
        <p>Keep your collection moving. Keep your rewards close.</p>
        <Link className="ns-text-link" href="/rewards" prefetch={false}>
          Explore Northside Rewards <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <div className="ns-wallet" aria-busy={!current}>
        {!current ? (
          <p role="status">Loading your rewards…</p>
        ) : current.state === "error" ? (
          <>
            <h3>Rewards are taking a moment.</h3>
            <p role="status">Your wallet couldn’t be loaded.</p>
            <button
              className="ns-text-link"
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again <ArrowRight size={16} aria-hidden="true" />
            </button>
          </>
        ) : current.state === "guest" ? (
          <>
            <h3>A little more for your collection.</h3>
            <p>Sign in to see your points and tier.</p>
            <Link
              className="ns-button"
              href="/account?returnTo=%2Frewards"
              prefetch={false}
            >
              Your account <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </>
        ) : wallet?.state === "ready" ? (
          <>
            <dl>
              <div>
                <dt>Points balance</dt>
                <dd>{wallet.balance!.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Your tier</dt>
                <dd className="ns-tier">
                  {wallet.tier?.label || "Not assigned"}
                </dd>
              </div>
            </dl>
            {wallet.held > 0 && (
              <p>{wallet.held.toLocaleString("en-US")} points reserved</p>
            )}
            {wallet.negative_review && (
              <p>Your balance is under review. See your wallet for details.</p>
            )}
            <Link className="ns-text-link" href="/rewards" prefetch={false}>
              View your wallet <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            <h3>
              {wallet?.state === "not_enrolled"
                ? "Make yourself at home."
                : "Rewards are getting ready."}
            </h3>
            <p>
              {wallet?.state === "not_enrolled"
                ? "Explore the Northside program in your rewards wallet."
                : "Earning and redemption aren’t open yet. Explore the program for the latest details."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
