import "server-only";
import { randomBytes } from "node:crypto";
import { type Sql, type Actor, requireRole } from "./db";
import { AccessError } from "./security";
import { integer, shortText, uuid } from "./loyalty";
import { gid, cents } from "./shopify-config";
import { publicFlags } from "../policy.mjs";
import { type Query, storefront } from "./storefront";
import {
  inventoryPools,
  parseScan,
  pickupNext,
  type Aisle,
  type StoreNode,
  type StoreLocation,
  type StoreProduct,
  type StoreVariant,
  type StoreQR,
  type RetailProduct,
  type ScanResult,
} from "../store";
export type StoreMode = "live" | "sample";
export function storeMode(mode: StoreMode) {
  if (mode === "sample" && process.env.NODE_ENV === "production")
    throw new AccessError(404, "not_found");
  return mode === "sample";
}
export function storeGate(feature: "scanner" | "aisles" | "pickup") {
  const enabled =
    feature === "scanner"
      ? publicFlags.barcodeScanning
      : feature === "aisles"
        ? publicFlags.aisleNavigation
        : publicFlags.pickup;
  if (!enabled) throw new AccessError(404, "not_found");
}
export function qrOrigin(mode: StoreMode = "live") {
  if (storeMode(mode)) return "http://127.0.0.1:3000";
  const raw = process.env.NORTHSIDE_QR_ORIGIN || "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AccessError(503, "qr_domain_not_configured");
  }
  if (
    u.protocol !== "https:" ||
    u.origin !== raw ||
    u.username ||
    u.password ||
    u.hostname === "localhost" ||
    /^127\./.test(u.hostname)
  )
    throw new AccessError(503, "qr_domain_not_configured");
  return u.origin;
}
export const qrLink = (token: string, mode: StoreMode = "live") => {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token))
    throw new AccessError(400, "invalid_qr_token");
  return qrOrigin(mode) + (storeMode(mode) ? "/q/sample/" : "/q/") + token;
};
const optional = (v: unknown, max = 100) =>
  v == null || v === "" ? null : shortText(v, max);
const strings = (v: unknown) => {
  if (!Array.isArray(v) || v.length > 20)
    throw new AccessError(400, "invalid_label_list");
  const result = v.map((x) => shortText(x, 80));
  if (new Set(result).size !== result.length)
    throw new AccessError(400, "duplicate_labels");
  return result;
};
export async function storeAudit(
  db: Sql,
  a: Actor,
  id: string,
  action: string,
  reason: string,
  before: unknown = null,
  after: unknown = null,
) {
  await db.query(
    "insert into ns.store_audit(tenant_id,actor_id,object_id,action,reason,before_value,after_value) values($1,$2,$3,$4,$5,$6,$7)",
    [
      a.tenant_id,
      a.staff_id,
      id,
      action,
      shortText(reason),
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}
async function lockStore(db: Sql, a: Actor) {
  requireRole(a, ["owner", "admin", "operations"]);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    a.tenant_id + "/store-config",
  ]);
}
async function save<T>(
  db: Sql,
  a: Actor,
  table: string,
  id: string,
  version: number | null,
  fields: Record<string, unknown>,
  reason: string,
): Promise<T> {
  await lockStore(db, a);
  uuid(id);
  shortText(reason);
  const old = (
    await db.query<Record<string, unknown>>(
      `select * from ns.${table} where tenant_id=$1 and id=$2 for update`,
      [a.tenant_id, id],
    )
  ).rows[0];
  if (old) {
    if (version === null)
      throw new AccessError(409, "record_already_exists_reload");
    if (old.version !== integer(version, 1))
      throw new AccessError(409, "record_changed_reload");
  } else if (version !== null) throw new AccessError(404, "record_not_found");
  const keys = Object.keys(fields),
    values = Object.values(fields);
  const row = (
    await db.query<T>(
      old
        ? `update ns.${table} set ${keys.map((k, i) => k + "=$" + (i + 3)).join(",")},version=version+1 where tenant_id=$1 and id=$2 returning *`
        : `insert into ns.${table}(tenant_id,id,${keys.join(",")}) values($1,$2,${keys.map((_, i) => "$" + (i + 3)).join(",")}) returning *`,
      [a.tenant_id, id, ...values],
    )
  ).rows[0];
  await storeAudit(
    db,
    a,
    id,
    table + (old ? ".updated" : ".created"),
    reason,
    old,
    fields,
  );
  return row;
}
export async function saveAisle(
  db: Sql,
  a: Actor,
  id: string,
  version: number,
  input: Record<string, unknown>,
  reason: string,
) {
  await lockStore(db, a);
  const sides = strings(input.sides);
  const used = (
    await db.query<{ side: string }>(
      "select side from ns.store_locations where tenant_id=$1 and aisle_id=$2 and active and side is not null",
      [a.tenant_id, uuid(id)],
    )
  ).rows;
  if (used.some((x) => !sides.includes(x.side)))
    throw new AccessError(409, "move_locations_before_removing_a_used_side");
  return save<Aisle>(
    db,
    a,
    "store_aisles",
    id,
    version,
    {
      label: shortText(input.label, 80),
      sides,
      categories: strings(input.categories),
      x: input.x == null ? null : integer(input.x, 0, 100),
      y: input.y == null ? null : integer(input.y, 0, 100),
      active: input.active === true,
    },
    reason,
  );
}
export async function saveNode(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
) {
  const kind = shortText(input.kind, 30);
  if (!["entrance", "service_counter", "path"].includes(kind))
    throw new AccessError(400, "invalid_node_kind");
  return save<StoreNode>(
    db,
    a,
    "store_nodes",
    id,
    version,
    {
      label: shortText(input.label, 80),
      kind,
      x: integer(input.x, 0, 100),
      y: integer(input.y, 0, 100),
      active: input.active === true,
    },
    reason,
  );
}
export async function saveEdge(
  db: Sql,
  a: Actor,
  from: string,
  to: string,
  active: boolean,
  reason: string,
) {
  await lockStore(db, a);
  uuid(from);
  uuid(to);
  if (from === to)
    throw new AccessError(400, "two_distinct_path_nodes_required");
  const ids = [from, to].sort();
  if (
    (
      await db.query(
        "select id from ns.store_nodes where tenant_id=$1 and id=any($2::uuid[]) and active",
        [a.tenant_id, ids],
      )
    ).rows.length !== 2
  )
    throw new AccessError(409, "active_path_nodes_required");
  const e = (
    await db.query<{ id: string }>(
      "insert into ns.store_edges(tenant_id,from_node,to_node,active) values($1,$2,$3,$4) on conflict(tenant_id,from_node,to_node) do update set active=excluded.active returning id",
      [a.tenant_id, ...ids, active],
    )
  ).rows[0];
  await storeAudit(db, a, e.id, "path.connection", reason, null, {
    from,
    to,
    active,
  });
  return e;
}
export async function saveLocation(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
) {
  await lockStore(db, a);
  const pool = shortText(input.pool, 20);
  if (!Object.hasOwn(inventoryPools, pool))
    throw new AccessError(400, "invalid_inventory_pool");
  const aisle = optional(input.aisle_id),
    side = optional(input.side, 80);
  if (pool !== "retail" && (aisle || input.approved_retail === true))
    throw new AccessError(
      400,
      "internal_pool_cannot_be_public_or_a_retail_aisle",
    );
  if (aisle) {
    const record = (
      await db.query<Aisle>(
        "select * from ns.store_aisles where tenant_id=$1 and id=$2 and active",
        [a.tenant_id, uuid(aisle)],
      )
    ).rows[0];
    if (!record || (side && !record.sides.includes(side)))
      throw new AccessError(400, "choose_an_active_aisle_and_configured_side");
  } else if (side) throw new AccessError(400, "side_requires_an_aisle");
  return save<StoreLocation>(
    db,
    a,
    "store_locations",
    id,
    version,
    {
      pool,
      label: shortText(input.label, 100),
      aisle_id: aisle,
      side,
      zone: optional(input.zone, 100) || "",
      categories: strings(input.categories),
      approved_retail: input.approved_retail === true,
      active: input.active === true,
    },
    reason,
  );
}
export async function saveProduct(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
  mode: StoreMode = "live",
) {
  const handle = shortText(input.handle, 150);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handle))
    throw new AccessError(400, "invalid_product_handle");
  return save<StoreProduct>(
    db,
    a,
    "store_products",
    id,
    version,
    {
      shopify_product_id: gid(input.shopify_product_id, "Product"),
      title: shortText(input.title, 150),
      family: shortText(input.family, 100),
      handle,
      fixture: storeMode(mode),
    },
    reason,
  );
}
export type CatalogProof = {
  id: string;
  title: string;
  handle: string;
  variants: {
    nodes: {
      id: string;
      title: string;
      sku: string | null;
      barcode: string | null;
      availableForSale: boolean;
      currentlyNotInStock: boolean;
      quantityAvailable: number | null;
      price: { amount: string; currencyCode: string };
    }[];
    pageInfo: { hasNextPage: boolean };
  };
};
export async function productProof(query: Query, id: string) {
  const p = (
    await query<{ node: CatalogProof | null }>(
      "query ScannedProduct($id:ID!){node(id:$id){... on Product{id title handle variants(first:100){nodes{id title sku barcode availableForSale currentlyNotInStock quantityAvailable price{amount currencyCode}} pageInfo{hasNextPage}}}}}",
      { id: gid(id, "Product") },
    )
  ).node;
  if (!p || p.id !== id)
    throw new AccessError(404, "product_unpublished_or_unavailable");
  if (p.variants.pageInfo.hasNextPage)
    throw new AccessError(409, "too_many_variants_use_staff_review");
  for (const v of p.variants.nodes) cents(v.price);
  return p;
}
export async function saveVariant(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
  mode: StoreMode = "live",
  query?: Query,
) {
  await lockStore(db, a);
  const product = (
    await db.query<StoreProduct>(
      "select * from ns.store_products where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(input.product_id)],
    )
  ).rows[0];
  if (!product || product.fixture !== storeMode(mode))
    throw new AccessError(404, "product_not_found");
  const variant = gid(input.shopify_variant_id, "ProductVariant"),
    sku = shortText(input.sku, 80),
    barcode = optional(input.barcode, 64);
  if (barcode && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(barcode))
    throw new AccessError(400, "invalid_product_barcode");
  const verified = input.verified === true,
    evidence = shortText(input.evidence, 1000);
  if (verified && mode === "live") {
    const p = await productProof(
        query || storefront(),
        product.shopify_product_id,
      ),
      v = p.variants.nodes.find((v) => v.id === variant);
    if (
      !v ||
      p.handle !== product.handle ||
      v.sku !== sku ||
      (v.barcode || null) !== barcode
    )
      throw new AccessError(409, "shopify_variant_sku_barcode_mismatch");
  }
  return save<StoreVariant>(
    db,
    a,
    "store_variants",
    id,
    version,
    {
      product_id: product.id,
      shopify_variant_id: variant,
      sku,
      barcode,
      verified,
      evidence,
    },
    reason,
  );
}
export async function assignLocation(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  variant: string,
  location: string,
  reason: string,
) {
  await lockStore(db, a);
  uuid(variant);
  uuid(location);
  if (
    !(
      await db.query(
        "select id from ns.store_variants where tenant_id=$1 and id=$2",
        [a.tenant_id, variant],
      )
    ).rows.length ||
    !(
      await db.query(
        "select id from ns.store_locations where tenant_id=$1 and id=$2 and active",
        [a.tenant_id, location],
      )
    ).rows.length
  )
    throw new AccessError(404, "variant_or_active_location_not_found");
  return save(
    db,
    a,
    "store_assignments",
    id,
    version,
    { variant_id: variant, location_id: location },
    reason,
  );
}
export async function saveQR(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
) {
  await lockStore(db, a);
  const product = uuid(input.product_id),
    variant = optional(input.variant_id),
    placement = optional(input.placement_id),
    campaign = optional(input.campaign_key, 80),
    destination = shortText(input.destination, 30);
  if (
    !["product", "retail_locator"].includes(destination) ||
    (campaign && !/^[a-z0-9][a-z0-9_-]*$/.test(campaign))
  )
    throw new AccessError(400, "invalid_destination_or_campaign");
  if (
    !(
      await db.query(
        "select id from ns.store_products where tenant_id=$1 and id=$2",
        [a.tenant_id, product],
      )
    ).rows.length
  )
    throw new AccessError(404, "product_not_found");
  if (
    variant &&
    !(
      await db.query(
        "select id from ns.store_variants where tenant_id=$1 and id=$2 and product_id=$3",
        [a.tenant_id, uuid(variant), product],
      )
    ).rows.length
  )
    throw new AccessError(400, "variant_does_not_belong_to_product");
  if (
    placement &&
    !(
      await db.query(
        "select id from ns.store_locations where tenant_id=$1 and id=$2 and active",
        [a.tenant_id, uuid(placement)],
      )
    ).rows.length
  )
    throw new AccessError(404, "placement_not_found");
  return save<StoreQR>(
    db,
    a,
    "store_qr",
    id,
    version,
    {
      product_id: product,
      variant_id: variant,
      placement_id: placement,
      campaign_key: campaign,
      destination,
      active: input.active === true,
      ...(version === null
        ? { token: randomBytes(18).toString("base64url") }
        : {}),
    },
    reason,
  );
}
export async function storeStaff(db: Sql, a: Actor, mode: StoreMode = "live") {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const sample = storeMode(mode);
  let qr_origin: string | null = null;
  try {
    qr_origin = qrOrigin(mode);
  } catch (e) {
    if (!(e instanceof AccessError) || e.code !== "qr_domain_not_configured")
      throw e;
  }
  return {
    qr_origin,
    role: a.staff_role,
    schematic: true,
    aisles: (
      await db.query<Aisle>(
        "select * from ns.store_aisles where tenant_id=$1 order by number",
        [a.tenant_id],
      )
    ).rows,
    nodes: (
      await db.query<StoreNode>(
        "select * from ns.store_nodes where tenant_id=$1 order by label limit 100",
        [a.tenant_id],
      )
    ).rows,
    edges: (
      await db.query<{
        id: string;
        from_node: string;
        to_node: string;
        active: boolean;
      }>("select * from ns.store_edges where tenant_id=$1 limit 300", [
        a.tenant_id,
      ])
    ).rows,
    locations: (
      await db.query<StoreLocation>(
        "select * from ns.store_locations where tenant_id=$1 order by pool,label limit 500",
        [a.tenant_id],
      )
    ).rows,
    products: (
      await db.query<StoreProduct>(
        "select * from ns.store_products where tenant_id=$1 and fixture=$2 order by title limit 500",
        [a.tenant_id, sample],
      )
    ).rows,
    variants: (
      await db.query<StoreVariant>(
        "select v.* from ns.store_variants v join ns.store_products p on p.tenant_id=v.tenant_id and p.id=v.product_id where v.tenant_id=$1 and p.fixture=$2 order by v.sku limit 1000",
        [a.tenant_id, sample],
      )
    ).rows,
    assignments: (
      await db.query<{
        id: string;
        variant_id: string;
        location_id: string;
        version: number;
      }>("select * from ns.store_assignments where tenant_id=$1 limit 2000", [
        a.tenant_id,
      ])
    ).rows,
    qrs: (
      await db.query<StoreQR>(
        "select q.* from ns.store_qr q join ns.store_products p on p.tenant_id=q.tenant_id and p.id=q.product_id where q.tenant_id=$1 and p.fixture=$2 order by q.id limit 500",
        [a.tenant_id, sample],
      )
    ).rows,
    pickups: (
      await db.query<{
        id: string;
        customer_id: string;
        order_id: string;
        state: string;
        version: number;
      }>(
        "select * from ns.store_pickups where tenant_id=$1 and fixture=$2 order by id limit 100",
        [a.tenant_id, sample],
      )
    ).rows,
    audit: (
      await db.query<{
        id: string;
        action: string;
        reason: string;
        created_at: string;
      }>(
        "select id,action,reason,created_at from ns.store_audit where tenant_id=$1 order by created_at desc limit 100",
        [a.tenant_id],
      )
    ).rows,
    customers: (
      await db.query<{ id: string; display_name: string }>(
        "select id,display_name from ns.customers where tenant_id=$1 order by display_name limit 500",
        [a.tenant_id],
      )
    ).rows,
  };
}
export async function resolveScan(
  db: Sql,
  input: unknown,
  mode: StoreMode = "live",
  query?: Query,
): Promise<ScanResult> {
  const sample = storeMode(mode);
  let parsed;
  try {
    parsed = parseScan(input, qrOrigin(mode), sample);
  } catch (e) {
    if (e instanceof AccessError) throw e;
    throw new AccessError(
      400,
      e instanceof Error ? e.message : "unsupported_code",
    );
  }
  const targets = (
    await db.query<{
      product_id: string;
      variant_id: string | null;
      campaign_key: string | null;
      destination: string;
    }>("select * from ns.store_public_target($1,$2,$3)", [
      parsed.kind,
      parsed.value,
      sample,
    ])
  ).rows;
  if (targets.length !== 1)
    throw new AccessError(404, "code_not_registered_or_disabled");
  const t = targets[0],
    p = (
      await db.query<{ product: RetailProduct | null }>(
        "select ns.store_retail_product($1,$2) product",
        [t.product_id, sample],
      )
    ).rows[0].product;
  if (!p) throw new AccessError(404, "product_not_found");
  if (!p.variants.length)
    throw new AccessError(409, "missing_or_unverified_variant");
  const selected = t.variant_id
    ? p.variants.find((v) => v.id === t.variant_id)?.variant_id
    : parsed.variant || null;
  if (
    (t.variant_id || parsed.variant) &&
    !p.variants.some((v) => v.variant_id === selected)
  )
    throw new AccessError(409, "missing_or_unverified_variant");
  const proof = sample
    ? null
    : await productProof(query || storefront(), p.product_id);
  if (proof) {
    p.title = proof.title;
    p.handle = proof.handle;
    for (const v of p.variants) {
      const current = proof.variants.nodes.find((x) => x.id === v.variant_id);
      if (
        current &&
        (current.sku !== v.sku ||
          (parsed.kind === "barcode" &&
            v.variant_id === selected &&
            current.barcode !== parsed.value))
      )
        throw new AccessError(
          409,
          "catalog_mapping_changed_staff_review_required",
        );
    }
  }
  const variants = p.variants.map((v) => {
    const live = proof?.variants.nodes.find((x) => x.id === v.variant_id);
    return {
      id: v.variant_id,
      title: live?.title || v.sku,
      available: sample
        ? !v.sku.includes("SOLDOUT")
        : !!live?.availableForSale &&
          !live.currentlyNotInStock &&
          live.quantityAvailable !== null &&
          live.quantityAvailable > 0,
      quantity: sample
        ? v.sku.includes("SOLDOUT")
          ? 0
          : 3
        : (live?.quantityAvailable ?? null),
      price: live?.price || {
        amount: sample ? "12.00" : "0.00",
        currencyCode: "USD",
      },
    };
  });
  if (proof) {
    p.variants = p.variants.filter((v) =>
      proof.variants.nodes.some((x) => x.id === v.variant_id),
    );
    if (selected && !p.variants.some((v) => v.variant_id === selected))
      throw new AccessError(409, "variant_no_longer_published");
  }
  if (!p.variants.length)
    throw new AccessError(409, "missing_or_unverified_variant");
  return {
    product: p,
    selected_variant: selected || null,
    campaign_key: t.campaign_key,
    destination: t.destination,
    availability: {
      checked_at: new Date().toISOString(),
      source: sample ? "sample" : "shopify",
      variants: variants.filter((v) =>
        p.variants.some((x) => x.variant_id === v.id),
      ),
    },
  };
}
export async function searchStore(
  db: Sql,
  a: Actor,
  text: unknown,
  mode: StoreMode = "live",
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  const q = shortText(text, 80);
  return (
    await db.query<StoreProduct>(
      "select distinct p.* from ns.store_products p left join ns.store_variants v on v.tenant_id=p.tenant_id and v.product_id=p.id where p.tenant_id=$1 and p.fixture=$2 and (position(lower($3) in lower(p.title))>0 or position(lower($3) in lower(p.family))>0 or position(lower($3) in lower(v.sku))>0 or v.barcode=$3) order by p.title limit 30",
      [a.tenant_id, storeMode(mode), q],
    )
  ).rows;
}
export async function pickupRehearsal(
  db: Sql,
  a: Actor,
  id: string,
  version: number | null,
  input: Record<string, unknown>,
  reason: string,
  mode: StoreMode = "live",
) {
  await lockStore(db, a);
  if (!storeMode(mode)) throw new AccessError(503, "pickup_not_activated");
  const old = (
    await db.query<{ state: string }>(
      "select state from ns.store_pickups where tenant_id=$1 and id=$2",
      [a.tenant_id, uuid(id)],
    )
  ).rows[0];
  const state = shortText(input.state, 20);
  if (old ? !pickupNext(old.state, state) : state !== "paid")
    throw new AccessError(409, "pickup_step_not_allowed");
  const customer = uuid(input.customer_id);
  if (
    !(
      await db.query<{ ok: boolean }>("select ns.grading_verified($1,$2) ok", [
        a.tenant_id,
        customer,
      ])
    ).rows[0].ok
  )
    throw new AccessError(409, "verified_sample_customer_required");
  return save(
    db,
    a,
    "store_pickups",
    id,
    version,
    {
      customer_id: customer,
      order_id: shortText(input.order_id, 100),
      state,
      fixture: true,
    },
    reason,
  );
}
