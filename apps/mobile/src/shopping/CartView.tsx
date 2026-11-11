import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Button, Card, SectionHeading } from "../components/Controls";
import { StatePanel } from "../components/StatePanel";
import { money, storefrontUi as ui } from "../mvp/Components";
import { storefront } from "../theme";
import { useShopping } from "./Provider";
import { shoppingMessage } from "./messages";

export function CartView({ onScan }: { onScan: () => void }) {
  const { controller, state } = useShopping();
  const cart = state.cart;
  const frozen = cart?.phase === "ready_for_staff";
  const disabled = state.busy || !!state.needsRefresh || frozen;
  const run = (operation: Promise<unknown>) => {
    void operation.catch(() => {});
  };
  return (
    <View style={styles.list}>
      <SectionHeading title="Your items" />
      {cart?.sample && (
        <Text style={styles.sample}>LOCAL REHEARSAL · TEST ITEMS ONLY</Text>
      )}
      {state.error && (
        <Text accessibilityRole="alert" style={ui.copy}>
          {shoppingMessage(state.error)}
        </Text>
      )}
      {state.busy && (
        <Text accessibilityLiveRegion="polite" style={ui.copy}>
          Checking your shopping list…
        </Text>
      )}
      {!cart && !state.busy && (
        <StatePanel
          appearance="storefront"
          icon="shop"
          state={{
            status:
              state.status === "error" || state.status === "unconfigured"
                ? "unavailable"
                : "empty",
            title:
              state.status === "unconfigured"
                ? "Store connection unavailable"
                : state.needsRefresh
                  ? "Refresh your shopping list"
                  : "No items yet",
            message:
              state.status === "unconfigured"
                ? "Ask an associate for help at the counter."
                : state.needsRefresh
                  ? "Reconnect to reload the store’s saved list."
                  : "Scan an item to review it before adding.",
          }}
        />
      )}
      {state.needsRefresh && (
        <Button
          appearance="storefront"
          label="Refresh shopping list"
          disabled={state.busy}
          onPress={() => run(controller.read())}
        />
      )}
      {state.status === "error" && !state.needsRefresh && (
        <Button
          appearance="storefront"
          label="Start a new list"
          disabled={state.busy}
          onPress={() => run(controller.newCart())}
        />
      )}
      {cart?.lines.map((line) => (
        <Card appearance="storefront" key={line.variantId}>
          {line.image && (
            <Image
              source={{ uri: line.image.url }}
              alt={line.image.altText ?? line.title}
              contentFit="contain"
              accessibilityLabel={line.image.altText ?? line.title}
              style={styles.image}
            />
          )}
          <Text accessibilityRole="header" style={styles.title}>
            {line.title}
          </Text>
          <Text style={ui.copy}>{line.variantTitle}</Text>
          {line.sku && <Text style={ui.copy}>SKU: {line.sku}</Text>}
          {line.availability === "unavailable" && (
            <Text accessibilityRole="alert" style={ui.copy}>
              Current quantity unavailable. Reduce or remove this item.
            </Text>
          )}
          <Text style={ui.label}>
            {money(line.priceCents)} each · reviewed price
          </Text>
          {line.lineTotalCents !== undefined && (
            <Text style={ui.copy}>Line total {money(line.lineTotalCents)}</Text>
          )}
          <View style={styles.quantity}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Decrease quantity of ${line.title}, ${line.variantTitle}`}
              accessibilityState={{ disabled: disabled || line.quantity <= 1 }}
              disabled={disabled || line.quantity <= 1}
              onPress={() =>
                run(controller.set(line.variantId, line.quantity - 1))
              }
              style={[
                styles.step,
                (disabled || line.quantity <= 1) && styles.disabled,
              ]}
            >
              <Text style={styles.symbol}>−</Text>
            </Pressable>
            <Text
              accessibilityLabel={`Quantity ${line.quantity}`}
              style={ui.label}
            >
              Quantity {line.quantity}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Increase quantity of ${line.title}, ${line.variantTitle}`}
              accessibilityState={{
                disabled:
                  disabled ||
                  line.quantity >= 99 ||
                  line.availability === "unavailable",
              }}
              disabled={
                disabled ||
                line.quantity >= 99 ||
                line.availability === "unavailable"
              }
              onPress={() =>
                run(controller.set(line.variantId, line.quantity + 1))
              }
              style={[
                styles.step,
                (disabled || line.quantity >= 99) && styles.disabled,
              ]}
            >
              <Text style={styles.symbol}>+</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${line.title}, ${line.variantTitle}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => run(controller.set(line.variantId, 0))}
            style={styles.remove}
          >
            <Text style={styles.removeText}>Remove item</Text>
          </Pressable>
        </Card>
      ))}
      {cart && (
        <Card appearance="storefront">
          <Text style={ui.label}>Reviewed subtotal</Text>
          <Text style={styles.subtotal}>{money(cart.subtotalCents)}</Text>
          {cart.cost && (
            <Text style={ui.label}>
              Shopify {cart.cost.estimated ? "estimated " : ""}total{" "}
              {money(cart.cost.totalCents)}
            </Text>
          )}
          <Text style={ui.copy}>
            Final price and tax are confirmed at the counter. Your items are
            unpaid and stock is not reserved.
          </Text>
        </Card>
      )}
      {cart?.handoff ? (
        <Card appearance="storefront">
          <Text style={styles.sample}>UNPAID · COUNTER HANDOFF</Text>
          <Text accessibilityRole="header" style={ui.heading}>
            {state.handoffExpired
              ? "Counter code expired"
              : "Take your items to the counter"}
          </Text>
          <Text style={ui.copy}>
            {state.handoffExpired
              ? "Cancel this handoff to prepare a new code."
              : "Show this code to an associate. Payment is completed separately at the register."}
          </Text>
          {!state.handoffExpired && state.qr && (
            <Image
              source={{ uri: state.qr }}
              alt="Unpaid counter handoff QR"
              contentFit="contain"
              style={styles.qr}
              accessibilityLabel="Unpaid counter handoff QR"
            />
          )}
          {!state.handoffExpired && (
            <>
              <Text selectable style={styles.reference}>
                {cart.handoff.reference}
              </Text>
              <Text style={ui.copy}>
                Valid until{" "}
                {new Date(cart.handoff.expiresAt).toLocaleTimeString("en-US", {
                  timeZone: "America/Chicago",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
                .
              </Text>
            </>
          )}
          <Button
            appearance="storefront"
            secondary
            label="Cancel handoff and keep shopping"
            disabled={state.busy}
            onPress={() => run(controller.cancel())}
          />
        </Card>
      ) : (
        <Button
          appearance="storefront"
          label={
            cart?.source === "shopify_cart"
              ? "Checkout unavailable"
              : "Ready to Purchase"
          }
          disabled={
            cart?.source === "shopify_cart" ||
            !cart?.lines.length ||
            state.busy ||
            !!state.needsRefresh
          }
          onPress={() => run(controller.ready())}
        />
      )}
      {cart?.source === "shopify_cart" && (
        <Text style={ui.copy}>
          Checkout and POS handoff are not enabled. This cart is unpaid and does
          not reserve stock.
        </Text>
      )}
      {cart && (
        <Button
          appearance="storefront"
          secondary
          label="Refresh shopping list"
          disabled={state.busy}
          onPress={() => run(controller.read())}
        />
      )}
      <Button
        appearance="storefront"
        secondary
        label="Back to scanner"
        onPress={onScan}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  list: { gap: 20 },
  image: { width: "100%", height: 140 },
  qr: { width: "100%", height: 232 },
  title: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "700",
    color: storefront.colors.ink,
  },
  sample: { ...storefront.type.eyebrow, color: storefront.colors.accent },
  quantity: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  step: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: storefront.colors.border,
    borderRadius: 8,
  },
  symbol: { fontSize: 28, color: storefront.colors.accent },
  disabled: { opacity: 0.4 },
  remove: { minHeight: 48, justifyContent: "center" },
  removeText: { ...storefront.type.button, color: storefront.colors.accent },
  subtotal: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    color: storefront.colors.ink,
  },
  reference: {
    fontSize: 16,
    lineHeight: 24,
    color: storefront.colors.ink,
    flexShrink: 1,
  },
});
