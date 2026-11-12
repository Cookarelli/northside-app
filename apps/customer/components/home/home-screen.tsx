import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, ArrowUpRight, ScanLine } from "lucide-react";
import { fixturesAllowed, publicFlags } from "@/lib/policy.mjs";
import { NextBreak } from "@/components/break-workspace";
import {
  HomeMerchandising,
  HomeEvents,
  MerchandisingLoading,
} from "./home-data";
import { HomeLoyalty } from "./home-loyalty";

const categories = [
  {
    title: "Sports Cards",
    detail: "Find your next favorite",
    image: "/home/sports.webp",
    href: "/shop",
  },
  {
    title: "Pokémon",
    detail: "Keep the adventure going",
    image: "/home/pokemon.webp",
    href: "/shop?q=Pok%C3%A9mon",
  },
  {
    title: "Entertainment",
    detail: "A little more you",
    image: "/home/entertainment.webp",
    href: "/shop?q=Entertainment",
  },
] as const;

// Original Northside photographs supplied by the user; optimized without content edits.
export const homePhotography: { hero: string | null; lounge: string | null } = {
  hero: "/home/northside-led-wall.webp",
  lounge: "/home/northside-lounge-bar.webp",
};

export function HomeScreen() {
  const sample = fixturesAllowed(process.env);
  return (
    <div className="ns-home">
      <section className="ns-hero" aria-labelledby="home-title">
        {homePhotography.hero && (
          <Image
            className="ns-hero-photo"
            src={homePhotography.hero}
            alt=""
            fill
            sizes="100vw"
            preload
          />
        )}
        <div className="ns-hero-shade" />
        <div className="ns-content ns-hero-content">
          <p className="ns-kicker">CARDS. COMMUNITY. NORTHSIDE.</p>
          <h1 id="home-title">
            HOBBY
            <br />
            LIVES <span>HERE.</span>
          </h1>
          <p className="ns-hero-copy">
            Your next great find.
            <br className="ns-mobile-break" /> Your kind of people.
          </p>
          <div className="ns-hero-actions">
            <Link className="ns-button" href="/shop" prefetch={false}>
              Shop Products <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className="ns-button ns-button-outline" href="#lounge">
              Explore the Lounge <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <span className="ns-hero-caption">
            FOR THE LOVE OF THE COLLECTION
          </span>
        </div>
      </section>

      <section
        className="ns-content ns-shopping"
        aria-labelledby="shopping-title"
      >
        <div className="ns-section-heading">
          <div>
            <p className="ns-kicker">FIND YOUR THING</p>
            <h2 id="shopping-title">Shop by category</h2>
          </div>
          <Link className="ns-text-link" href="/shop" prefetch={false}>
            Shop all <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="ns-categories">
          {categories.map((category) => (
            <Link
              className="ns-category"
              href={category.href}
              key={category.title}
              prefetch={false}
            >
              <div className="ns-category-image">
                <Image
                  src={category.image}
                  alt=""
                  width={340}
                  height={400}
                  sizes="(max-width: 600px) 28vw, 240px"
                />
              </div>
              <div className="ns-category-copy">
                <h3>{category.title}</h3>
                <p>{category.detail}</p>
                <ArrowUpRight size={19} aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
        {(sample || publicFlags.barcodeScanning) && (
          <div className="ns-scan-entry">
            <ScanLine size={22} aria-hidden="true" />
            <p>Shopping in store?</p>
            <Link href="/scan" prefetch={false}>
              Scan a product <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <Link href="/cart?inStore=1" prefetch={false}>
              In-store cart
            </Link>
          </div>
        )}
      </section>

      <Suspense fallback={<MerchandisingLoading />}>
        <HomeMerchandising sample={sample} />
      </Suspense>

      <section
        className="ns-happenings"
        id="happenings"
        aria-labelledby="happenings-title"
      >
        <div className="ns-content">
          <div className="ns-section-heading">
            <div>
              <p className="ns-kicker">BETTER TOGETHER</p>
              <h2 id="happenings-title">Breaks &amp; events</h2>
            </div>
            <Link className="ns-text-link" href="/breaks" prefetch={false}>
              All breaks <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="ns-happenings-grid">
            <NextBreak fixture={sample} />
            <Suspense
              fallback={
                <div className="ns-event-panel" role="status">
                  Loading upcoming events…
                </div>
              }
            >
              <HomeEvents />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="ns-lounge" id="lounge" aria-labelledby="lounge-title">
        {homePhotography.lounge && (
          <Image
            className="ns-lounge-photo"
            src={homePhotography.lounge}
            alt="Northside bar counter illuminated by blue LED lighting"
            fill
            sizes="100vw"
          />
        )}
        <div className="ns-lounge-shade" />
        <div className="ns-content ns-lounge-content">
          <p className="ns-kicker">THE NORTHSIDE SPORTS LOUNGE</p>
          <h2 id="lounge-title">
            The Northside
            <br />
            <span>Sports Lounge</span>
          </h2>
          <p>
            Great cards. Good company.
            <br />
            Make yourself at home at Northside.
          </p>
          <a className="ns-button ns-button-outline" href="#happenings">
            See what’s happening <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
      </section>

      <HomeLoyalty sample={sample} />
    </div>
  );
}
