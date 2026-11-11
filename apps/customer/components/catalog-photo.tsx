"use client";

import { useState } from "react";
import Image from "next/image";
import { catalogImageV1Schema } from "../../../packages/customer-contracts/src/catalog";
import type { Merchandise } from "../lib/commerce";

type Props = Pick<Merchandise, "featuredImage" | "title">;

export function CatalogPhoto(props: Props) {
  return (
    <PhotoAttempt key={props.featuredImage?.url ?? "missing"} {...props} />
  );
}

function PhotoAttempt({ featuredImage, title }: Props) {
  const [failed, setFailed] = useState(false);
  const parsed = catalogImageV1Schema.safeParse(featuredImage);
  if (!parsed.success || failed)
    return (
      <div
        className="catalog-image missing-image"
        role="img"
        aria-label={`Product photo unavailable: ${title}`}
      >
        Product photo unavailable
      </div>
    );
  return (
    <Image
      className="catalog-image"
      src={parsed.data.url}
      alt={parsed.data.altText?.trim() || title}
      width={700}
      height={700}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
