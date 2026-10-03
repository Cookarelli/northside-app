import Customer from "../../../src/in-store/customer";
import InStorePilot from "../../../src/in-store/pilot";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.COMMERCE_MODE !== "fixture"
  )
    return <InStorePilot />;
  const [{ path = [] }, query] = await Promise.all([params, searchParams]);
  const initialReference =
    typeof query.handoff === "string" ? query.handoff : "";
  const initialCollection =
    typeof query.collection === "string" ? query.collection : "";
  const requestedShared = query.shared === "1";
  return (
    <Customer
      key={JSON.stringify([
        path,
        initialReference,
        initialCollection,
        requestedShared,
      ])}
      path={path}
      initialReference={initialReference}
      initialCollection={initialCollection}
      requestedShared={requestedShared}
    />
  );
}
