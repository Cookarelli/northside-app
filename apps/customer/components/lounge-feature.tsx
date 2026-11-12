import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

// Presentation only: reuse the supplied Northside bar photo and existing Home anchor.
export function LoungeFeature({ eager = false }: { eager?: boolean }) {
  return (
    <aside className="ns-secondary-lounge" aria-label="Northside Sports Lounge">
      <Image
        src="/home/northside-lounge-bar.webp"
        loading={eager ? "eager" : "lazy"}
        alt="The Northside bar counter illuminated by blue LED lighting"
        fill
        sizes="(max-width: 1288px) 100vw, 1224px"
      />
      <div className="ns-secondary-lounge-copy">
        <p className="eyebrow">CARDS. COLLECTIBLES. COMMUNITY.</p>
        <h2>
          The Northside
          <br />
          <span>Sports Lounge</span>
        </h2>
        <p>
          Great cards. Good company.
          <br />
          Make yourself at home at Northside.
        </p>
        <Link className="button" href="/#lounge" prefetch={false}>
          Explore the lounge <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
