import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import type {
  TrackingService,
  TrackingList,
  TrackingDetail,
  ServiceTerms,
} from "@northside/customer-contracts/tracking";
import { useCustomerAuth } from "../../auth/Provider";
import { CustomerScreen } from "../../components/CustomerScreen";
import { ActionLink, Button, Card } from "../../components/Controls";
import { storefront } from "../../theme";

const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
type Loaded = { identity: string; value: TrackingList | TrackingDetail };
function PrivatePhoto({
  service,
  cardId,
  photo,
}: {
  service: TrackingService;
  cardId: string;
  photo: TrackingDetail["card"]["photos"][number];
}) {
  const { controller } = useCustomerAuth(),
    [uri, setUri] = useState<string>(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    active = useRef(false),
    request = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      return () => {
        active.current = false;
        request.current?.abort();
        setUri(undefined);
      };
    }, []),
  );
  return (
    <View style={styles.photo}>
      <Text style={styles.copy}>{photo.kind}</Text>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={`Your card: ${photo.kind}`}
          alt={`Your card: ${photo.kind}`}
          cachePolicy="none"
          contentFit="contain"
          style={styles.image}
          onError={() => {
            setUri(undefined);
            setError(true);
          }}
        />
      ) : (
        <Button
          appearance="storefront"
          secondary
          disabled={busy}
          label={
            busy
              ? "Loading private photo…"
              : error
                ? `Retry ${photo.kind} photo`
                : `View ${photo.kind} photo`
          }
          onPress={() => {
            request.current?.abort();
            const abort = new AbortController();
            request.current = abort;
            setBusy(true);
            setError(false);
            void controller
              .trackingPhoto(service, cardId, photo.id, abort.signal)
              .then((value) => {
                if (active.current && !abort.signal.aborted) setUri(value);
              })
              .catch(() => {
                if (active.current && !abort.signal.aborted) setError(true);
              })
              .finally(() => {
                if (active.current && !abort.signal.aborted) setBusy(false);
              });
          }}
        />
      )}{" "}
      {error && (
        <Text accessibilityRole="alert" style={styles.copy}>
          Photo unavailable. Retry when connected.
        </Text>
      )}
    </View>
  );
}
export default function MyCardsScreen() {
  const params = useLocalSearchParams<{ service?: string }>(),
    { controller, state } = useCustomerAuth();
  const [service, setService] = useState<TrackingService>(
      params.service === "consignment" ? "consignment" : "grading",
    ),
    [selected, setSelected] = useState<string>(),
    [resource, setResource] = useState<Loaded | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [savingKey, setSavingKey] = useState<{
      key: string;
      abort: AbortController;
    } | null>(null);
  const identity =
    state.status === "authenticated" && state.account
      ? `${state.account.customer.id}:${state.account.sessionExpiresAt}`
      : "";
  const key = `${identity}:${service}:${selected ?? "list"}:${revision}`;
  const scope = useRef({ epoch: 0, mutation: null as AbortController | null });
  useLayoutEffect(() => {
    const boundary = scope.current;
    boundary.epoch++;
    return () => {
      boundary.epoch++;
      boundary.mutation?.abort();
    };
  }, [key]);
  const saving = savingKey?.key === key && !savingKey.abort.signal.aborted;
  useFocusEffect(
    useCallback(() => {
      setResource(null);
      setConfirmed(false);
      setError("");
      if (!identity) return;
      let active = true;
      const abort = new AbortController();
      const read = selected
        ? controller.trackingDetail(service, selected, abort.signal)
        : controller.tracking(service, abort.signal);
      void read
        .then((value) => {
          if (active) setResource({ identity: key, value });
        })
        .catch(() => {
          if (active)
            setError(
              "Your cards could not be loaded. Check your connection and refresh.",
            );
        });
      return () => {
        active = false;
        abort.abort();
      };
    }, [controller, identity, key, selected, service]),
  );
  const data = resource?.identity === key ? resource.value : null;
  const detail = data?.kind === "card-tracking-detail" ? data : null;
  const terms: ServiceTerms | null = data?.terms ?? null;
  const acceptCard =
    detail?.card.cardId ??
    (data?.kind === "card-tracking" ? data.cards[0]?.cardId : undefined);
  return (
    <CustomerScreen
      eyebrow="Your collection"
      title="My Cards"
      description="Grading and consignment updates recorded by Northside."
    >
      <ActionLink href="/service-requests" label="Service requests & dated history" appearance="storefront" />
      <View style={styles.row}>
        {(["grading", "consignment"] as const).map((s) => (
          <View key={s} style={styles.choice}>
            <Button
              appearance="storefront"
              secondary={s !== service}
              disabled={saving}
              label={s === "grading" ? "Grading" : "Consignment"}
              onPress={() => {
                setService(s);
                setSelected(undefined);
                setResource(null);
                setConfirmed(false);
              }}
            />
          </View>
        ))}
      </View>
      {!identity ? (
        <Card appearance="storefront">
          <Text style={styles.copy}>
            {state.status === "unconfigured"
              ? "Customer sign-in is unavailable here. Your cards remain private."
              : "Sign in with your existing Shopify customer account to see your linked cards."}
          </Text>
          <Button
            appearance="storefront"
            disabled={
              state.status === "unconfigured" ||
              state.status === "booting" ||
              state.status === "authenticating"
            }
            label={
              state.status === "authenticating"
                ? "Continue in your browser"
                : "Sign in to My Cards"
            }
            onPress={() => {
              void controller.login(
                service === "grading"
                  ? "/my-cards?service=grading"
                  : "/my-cards?service=consignment",
              );
            }}
          />
        </Card>
      ) : (
        <>
          {selected && (
            <Button
              appearance="storefront"
              secondary
              label="Back to my cards"
              onPress={() => {
                setSelected(undefined);
                setResource(null);
              }}
            />
          )}
          {error ? (
            <Text accessibilityRole="alert" style={styles.copy}>
              {error}
            </Text>
          ) : (
            !data && (
              <Text accessibilityRole="progressbar" style={styles.copy}>
                Loading your saved cards…
              </Text>
            )
          )}
          {data?.kind === "card-tracking" &&
            (data.cards.length ? (
              data.cards.map((card) => (
                <Card appearance="storefront" key={card.id}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {card.title}
                  </Text>
                  <Text style={styles.copy}>{card.status}</Text>
                  <Text style={styles.copy}>
                    Updated {when(card.updatedAt)}
                  </Text>
                  <Button
                    appearance="storefront"
                    secondary
                    label={`View ${card.title}`}
                    onPress={() => {
                      setSelected(card.id);
                      setResource(null);
                    }}
                  />
                </Card>
              ))
            ) : (
              <Card appearance="storefront">
                <Text style={styles.title}>No linked {service} cards</Text>
                <Text style={styles.copy}>
                  An associate can help verify your intake receipt. This view
                  does not search other customers’ records.
                </Text>
              </Card>
            ))}
          {detail && (
            <Card appearance="storefront">
              <Text accessibilityRole="header" style={styles.title}>
                {detail.card.title}
              </Text>
              <Text style={styles.copy}>{detail.card.status}</Text>
              <Text style={styles.copy}>
                Drop-off date: {detail.card.receivedDate ?? "Not recorded"}
              </Text>
              <Text style={styles.copy}>
                Receipt recorded {when(detail.card.recordedAt)}
              </Text>
              <Text style={styles.copy}>
                Updated {when(detail.card.updatedAt)}
              </Text>
              {detail.card.providerCardReference && (
                <Text style={styles.copy}>
                  Provider card reference: {detail.card.providerCardReference}
                </Text>
              )}
              <Text style={styles.copy}>
                {detail.card.customerNotes || "No additional customer notes."}
              </Text>
              {detail.card.result && (
                <Text style={styles.copy}>
                  External result, recorded by staff: {detail.card.result}
                </Text>
              )}
              {detail.card.certificate && (
                <Text style={styles.copy}>
                  Certificate: {detail.card.certificate}
                </Text>
              )}
              <Text accessibilityRole="header" style={styles.title}>
                Card photographs
              </Text>
              {detail.card.photos.length ? (
                detail.card.photos.map((photo) => (
                  <PrivatePhoto
                    key={`${identity}:${photo.id}`}
                    service={service}
                    cardId={detail.card.id}
                    photo={photo}
                  />
                ))
              ) : (
                <Text style={styles.copy}>
                  No confirmed customer-visible photos are available yet.
                </Text>
              )}
              <Text accessibilityRole="header" style={styles.title}>
                Recorded history
              </Text>
              {detail.card.history.map((event) => (
                <View key={event.id}>
                  <Text style={styles.copy}>{event.label}</Text>
                  <Text style={styles.copy}>
                    {when(event.occurredAt)} ·{" "}
                    {event.source === "provider"
                      ? "Provider-recorded evidence"
                      : "Northside recorded"}
                  </Text>
                </View>
              ))}
            </Card>
          )}
          {terms && (
            <Card appearance="storefront">
              <Text accessibilityRole="header" style={styles.title}>
                {service === "grading" ? "Grading" : "Consignment"} service
                terms
              </Text>
              {terms.current ? (
                <>
                  <Text style={styles.title}>{terms.current.title}</Text>
                  <Text style={styles.copy}>
                    Version {terms.current.version}
                  </Text>
                  <Text style={styles.copy}>{terms.current.body}</Text>
                  {terms.acceptedAt ? (
                    <Text style={styles.copy}>
                      Accepted {when(terms.acceptedAt)}. This version does not
                      need another acceptance.
                    </Text>
                  ) : (
                    <>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: confirmed,
                          disabled: saving,
                        }}
                        disabled={saving}
                        style={styles.confirm}
                        onPress={() => setConfirmed((v) => !v)}
                      >
                        <Text style={styles.copy}>
                          {confirmed ? "☑" : "☐"} I have read and accept this
                          version of the {service} service terms.
                        </Text>
                      </Pressable>
                      <Button
                        appearance="storefront"
                        disabled={!confirmed || saving || !acceptCard}
                        label={
                          saving ? "Saving acceptance…" : "Record my acceptance"
                        }
                        onPress={() => {
                          if (!terms.current || !acceptCard) return;
                          const acceptedScope = scope.current.epoch,
                            abort = new AbortController();
                          scope.current.mutation = abort;
                          setSavingKey({ key, abort });
                          setConfirmed(false);
                          void controller
                            .acceptTerms(
                              {
                                service,
                                terms_id: terms.current.id,
                                card_id: acceptCard,
                                confirmed: true,
                              },
                              abort.signal,
                            )
                            .then(() => {
                              if (scope.current.epoch === acceptedScope)
                                setRevision((v) => v + 1);
                            })
                            .catch(() => {
                              if (scope.current.epoch !== acceptedScope) return;
                              setResource(null);
                              setError(
                                "Acceptance could not be confirmed. Refresh and review the current version before trying again.",
                              );
                            })
                            .finally(() => {
                              if (scope.current.epoch === acceptedScope)
                                setSavingKey(null);
                            });
                        }}
                      />
                    </>
                  )}
                </>
              ) : (
                <Text style={styles.copy}>
                  Service terms have not been configured. No acceptance is
                  recorded for an unavailable document.
                </Text>
              )}
              <Text style={styles.copy}>
                This is separate from approval of a particular grading quote and
                exam. It does not submit cards or authorize payment.
              </Text>
            </Card>
          )}
          <Button
            appearance="storefront"
            secondary
            label="Refresh my cards"
            disabled={saving}
            onPress={() => {
              setResource(null);
              setRevision((v) => v + 1);
            }}
          />
        </>
      )}
      <ActionLink
        appearance="storefront"
        href="/account"
        label="Back to Account"
        secondary
      />
    </CustomerScreen>
  );
}
const styles = StyleSheet.create({
  copy: {
    ...storefront.type.body,
    fontFamily: storefront.fontFamily,
    color: storefront.colors.body,
  },
  title: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "700",
    fontFamily: storefront.fontFamily,
    color: storefront.colors.ink,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  choice: { flex: 1, minWidth: 130 },
  confirm: { minHeight: 52, paddingVertical: 14 },
  photo: { gap: 10 },
  image: { width: "100%", height: 320 },
});
