import Customer from "../../../src/in-store/customer";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  return <Customer path={(await params).path ?? []} />;
}
