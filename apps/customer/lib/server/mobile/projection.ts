import type { CustomerProfile, CustomerOrder } from "../customer-commerce";
import type { Connection } from "../../commerce";
import { cents } from "../shopify-config";
import {
  MOBILE_CONTRACT_VERSION,
  mobileAccountSchema,
  mobileOrdersSchema,
} from "../../../../../packages/customer-contracts/src/mobile";

type Account = CustomerProfile & { orders: Connection<CustomerOrder> };
export function projectNativeOrders(customer: Account) {
  return mobileOrdersSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "orders",
    orders: customer.orders.nodes.map((order) => ({
      id: order.id,
      name: order.name,
      processedAt: new Date(order.processedAt).toISOString(),
      financialStatus: order.financialStatus,
      total: {
        amountCents: cents(order.totalPrice),
        currencyCode: order.totalPrice.currencyCode,
      },
    })),
    pageInfo: customer.orders.pageInfo,
  });
}
export function projectNativeAccount(
  customer: Account,
  customerId: string,
  expiresAt: string,
) {
  const nullable = (v: string | null | undefined) => (v?.trim() ? v : null);
  return mobileAccountSchema.parse({
    contractVersion: MOBILE_CONTRACT_VERSION,
    kind: "account",
    customer: {
      id: customerId,
      firstName: nullable(customer.firstName),
      lastName: nullable(customer.lastName),
      email: nullable(customer.emailAddress?.emailAddress),
    },
    sessionExpiresAt: expiresAt,
  });
}
