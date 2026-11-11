import { useCallback, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  requestSchema,
  type RequestConfig,
  type ServiceRequestInput,
  type ServiceRequestView,
} from "@northside/customer-contracts/service-requests";
import { useCustomerAuth } from "../auth/Provider";
import { MobileFailure } from "../api/client";
import { CustomerScreen } from "../components/CustomerScreen";
import { ActionLink, Button, Card } from "../components/Controls";
import { storefrontUi as ui } from "../mvp/Components";
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function ServiceRequestsScreen() {
  const { state } = useCustomerAuth();
  const identity =
    state.status === "authenticated" && state.account
      ? `${state.account.customer.id}:${state.account.sessionExpiresAt}`
      : "";
  return (
    <CustomerScreen
      eyebrow="NORTHSIDE SERVICES"
      title="Service requests"
      description="Consignment and grading staff review"
    >
      <ActionLink appearance="storefront" href="/my-cards" label="My Cards & private photos" />
      {identity ? (
        <RequestContent key={identity} />
      ) : (
        <>
          <Text style={ui.copy}>
            {state.status === "unconfigured"
              ? "Service requests are unavailable in this preview. Connect your account services to submit and view verified linked requests."
              : "Sign in to submit and view verified linked service requests."}
          </Text>
          <ActionLink appearance="storefront" href="/account" label="Open account" />
        </>
      )}
    </CustomerScreen>
  );
}
function RequestContent() {
  const { controller } = useCustomerAuth(),
    [config, setConfig] = useState<RequestConfig | null>(null),
    [requests, setRequests] = useState<ServiceRequestView[]>([]),
    [service, setService] = useState<"grading" | "consignment">("grading"),
    [kind, setKind] = useState<"inquiry" | "service_request">("inquiry"),
    [provider, setProvider] = useState("PSA"),
    [level, setLevel] = useState<string | null>(null),
    [delivery, setDelivery] = useState("planning_delivery"),
    [fields, setFields] = useState<Record<string, string>>({}),
    [accepted, setAccepted] = useState<string | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [busy, setBusy] = useState(false),
    [frozen, setFrozen] = useState(false);
  const epoch = useRef(0),
    abort = useRef<AbortController | null>(null),
    pending = useRef<ServiceRequestInput | null>(null),
    submitting = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const g = ++epoch.current;
      const a = new AbortController();
      abort.current = a;
      void Promise.all([
        controller.serviceRequestConfig(a.signal),
        controller.serviceRequests(a.signal),
      ])
        .then(([c, r]) => {
          if (g === epoch.current) {
            setConfig(c);
            setRequests(r.requests);
          }
        })
        .catch(() => {
          if (g === epoch.current)
            setError("Requests unavailable. Check sign-in and connection.");
        });
      return () => {
        epoch.current++;
        a.abort();
        abort.current?.abort();
        setConfig(null);
        setAccepted(null);
        setBusy(false);
        submitting.current = false;
        setRequests([]);
        setFields({});
        pending.current = null;
        setFrozen(false);
        setSaved("");
      };
    }, [controller]),
  );
  const input = (key: string, label: string, optional = false) => (
    <View key={key} style={s.field}>
      <Text style={ui.copy}>
        {label}
        {optional ? " (optional)" : ""}
      </Text>
      <TextInput
        accessibilityLabel={label}
        editable={!frozen && !busy}
        style={ui.input}
        value={fields[key] ?? ""}
        onChangeText={(v) => setFields((old) => ({ ...old, [key]: v }))}
        autoCapitalize={key === "email" ? "none" : "sentences"}
        keyboardType={
          key === "email"
            ? "email-address"
            : key === "phone"
              ? "phone-pad"
              : key === "listing_count"
                ? "number-pad"
                : "default"
        }
        secureTextEntry={key === "claim_token"}
        maxLength={["question", "instructions"].includes(key) ? 3000 : 200}
      />
    </View>
  );
  const term = config?.terms.find((t) => t.service === service);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const g = epoch.current;
    try {
      if (!pending.current) {
        const d = fields.declared_value ?? "";
        if (d && !/^\d+(\.\d{1,2})?$/.test(d))
          throw Error(
            "Declared value requires USD dollars and at most two decimal places.",
          );
        const bytes = await Crypto.getRandomBytesAsync(32);
        if (g !== epoch.current) return;
        const proposed = {
          request_id: Crypto.randomUUID(),
          claim_token: btoa(String.fromCharCode(...bytes))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", ""),
          kind,
          service,
          contact: {
            name: fields.name ?? "",
            email: fields.email ?? "",
            phone: fields.phone ?? "",
          },
          details:
            kind === "inquiry"
              ? { question: fields.question ?? "" }
              : service === "consignment"
                ? {
                    listing_count: Number(fields.listing_count),
                    delivery_method: delivery,
                    inbound_carrier:
                      delivery === "shipped" ? (fields.carrier ?? "") : "",
                    inbound_tracking_number:
                      delivery === "shipped" ? (fields.tracking ?? "") : "",
                    instructions: fields.instructions ?? "",
                  }
                : {
                    provider,
                    service_level_id: level,
                    declared_value_cents: d
                      ? Number(d.split(".")[0]) * 100 +
                        Number((d.split(".")[1] ?? "").padEnd(2, "0"))
                      : null,
                    address: Object.fromEntries(
                      [
                        "line1",
                        "line2",
                        "city",
                        "region",
                        "postal_code",
                        "country",
                      ].map((k) => [k, fields[k] ?? ""]),
                    ),
                    instructions: fields.instructions ?? "",
                  },
          terms_id: kind === "service_request" ? (term?.id ?? null) : null,
          terms_accepted: kind === "service_request" && accepted === term?.id,
        };
        const p = requestSchema.safeParse(proposed);
        if (!p.success)
          throw Error(
            p.error.issues
              .map((i) => `${i.path.join(" ")}: ${i.message}`)
              .join(". "),
          );
        pending.current = p.data;
        setFrozen(true);
      }
      const r = await controller.submitServiceRequest(
        pending.current,
        Platform.OS === "ios" ? "ios" : "android",
        abort.current?.signal,
      );
      if (g === epoch.current) {
        setSaved(`${r.reference}: ${r.next_steps}`);
        try {
          const list = await controller.serviceRequests(abort.current?.signal);
          if (g === epoch.current) setRequests(list.requests);
        } catch {
          if (g === epoch.current)
            setError("Your request was saved. Request history could not be refreshed; return to this screen when connected to load it.");
        }
      }
    } catch (e) {
      if (g === epoch.current) {
        if (e instanceof MobileFailure && ["request_terms_changed", "request_service_level_changed"].includes(e.code)) {
          pending.current = null;
          setFrozen(false);
          setAccepted(null);
          setLevel(null);
          setConfig(null);
          setError("Service details changed. Review the current options and terms before saving again.");
          try {
            const current = await controller.serviceRequestConfig(abort.current?.signal);
            if (g === epoch.current) setConfig(current);
          } catch {
            if (g === epoch.current) setError("Current service details could not be loaded. Return to this screen when connected before preparing a new request.");
          }
        } else {
          setError(e instanceof MobileFailure
            ? "Save unconfirmed. Retry the same request or ask Northside for help before starting another request."
            : e instanceof Error ? e.message : "Submission unconfirmed. Retry the same request.");
        }
      }
    } finally {
      if (g === epoch.current) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <View style={s.stack}>
      <Text style={ui.copy}>
        6800 Forest Hills Road, Unit 3, Loves Park, IL. Receiving ZIP and
        mail-in start date are unconfirmed. Do not mail cards based on this
        screen.
      </Text>
      {error && <Text accessibilityRole="alert" style={ui.copy}>{error}</Text>}
      {saved ? (
        <Text accessibilityRole="alert" style={ui.copy}>Saved {saved}</Text>
      ) : (
        <Card appearance="storefront">
          <Text style={ui.copy}>Service</Text>
          <View style={s.row}>
            {(["grading", "consignment"] as const).map((v) => (
              <Button appearance="storefront"
                key={v}
                label={v === service ? `Selected: ${v}` : v}
                disabled={frozen || busy}
                onPress={() => {
                  setService(v);
                  setAccepted(null);
                }}
              />
            ))}
          </View>
          <Text style={ui.copy}>Request type</Text>
          <View style={s.row}>
            {(["inquiry", "service_request"] as const).map((v) => (
              <Button appearance="storefront"
                key={v}
                label={
                  v === kind
                    ? `Selected: ${v.replaceAll("_", " ")}`
                    : v.replaceAll("_", " ")
                }
                disabled={frozen || busy}
                onPress={() => {
                  setKind(v);
                  setAccepted(null);
                }}
              />
            ))}
          </View>
          {input("name", "Full name")}
          {input("email", "Email")}
          {input("phone", "Phone")}
          {kind === "inquiry" ? (
            input("question", "Question")
          ) : service === "consignment" ? (
            <>
              {input("listing_count", "Number of listings / lots")}
              <Text style={ui.copy}>Delivery method</Text>
              {["planning_delivery", "already_dropped_off", "shipped"].map(
                (v) => (
                  <Button appearance="storefront"
                    key={v}
                    label={`${delivery === v ? "Selected: " : ""}${v.replaceAll("_", " ")}`}
                    disabled={frozen || busy}
                    onPress={() => setDelivery(v)}
                  />
                ),
              )}
              {delivery === "shipped" && (
                <>
                  {input("carrier", "Carrier", true)}
                  {input("tracking", "Tracking", true)}
                </>
              )}
              {input(
                "instructions",
                "Special instructions — enter None if none",
              )}
            </>
          ) : (
            <>
              <Text style={ui.copy}>Provider preference</Text>
              {["PSA", "SGC"].map((v) => (
                <Button appearance="storefront"
                  key={v}
                  label={`${provider === v ? "Selected: " : ""}${v}`}
                  disabled={frozen || busy}
                  onPress={() => {
                    setProvider(v);
                    setLevel(null);
                  }}
                />
              ))}
              <Text style={ui.copy}>Service level</Text>
              <Button appearance="storefront"
                label={
                  level === null ? "Selected: Staff review" : "Staff review"
                }
                disabled={frozen || busy}
                onPress={() => setLevel(null)}
              />
              {config?.serviceLevels
                .filter((l) => l.provider === provider)
                .map((l) => (
                  <Button appearance="storefront"
                    key={l.id}
                    label={`${level === l.id ? "Selected: " : ""}${l.name}`}
                    disabled={frozen || busy}
                    onPress={() => setLevel(l.id)}
                  />
                ))}
              {input("declared_value", "Declared value USD", true)}
              {[
                "line1",
                "line2",
                "city",
                "region",
                "postal_code",
                "country",
              ].map((k) =>
                input(
                  k,
                  {
                    line1: "Mailing address",
                    line2: "Address line 2",
                    city: "City",
                    region: "State / region",
                    postal_code: "Postal code",
                    country: "Country",
                  }[k]!,
                  k === "line2",
                ),
              )}
              {input("instructions", "Instructions", true)}
              <Text style={ui.copy}>
                Availability and price require staff confirmation. Provider
                processing begins at verified provider check-in.
              </Text>
            </>
          )}
          {kind === "service_request" &&
            (term ? (
              <>
                <Text style={ui.copy}>
                  {term.title} — {term.version}
                </Text>
                <Text style={ui.copy}>{term.body}</Text>
                <Text style={ui.copy}>I accept these applicable terms.</Text>
                <Switch
                  accessibilityLabel="I accept these applicable terms"
                  value={accepted === term.id}
                  disabled={frozen || busy}
                  onValueChange={(value) => setAccepted(value ? term.id : null)}
                />
              </>
            ) : (
              <Text style={ui.copy}>
                Full approved terms are not configured. Send an inquiry while
                terms are being confirmed.
              </Text>
            ))}
          <Button appearance="storefront"
            label={
              busy ? "Saving…" : frozen ? "Retry same request" : "Save request"
            }
            disabled={busy || !config || (kind === "service_request" && !term)}
            onPress={() => void submit()}
          />
        </Card>
      )}
      <Card appearance="storefront">
        <Text style={ui.copy}>Verified linked requests</Text>
        {requests.length ? (
          requests.map((r) => (
            <View key={r.id} style={s.field}>
              <Text style={ui.copy}>
                {r.reference} · {r.service} · {r.state}
              </Text>
              <Text style={ui.copy}>
                {r.received_at
                  ? `Physical receipt: ${new Date(r.received_at).toISOString().slice(0, 10)}`
                  : "Physical receipt unconfirmed"}
              </Text>
              {r.history.map((h, i) => (
                <Text key={i} style={ui.copy}>
                  {when(h.created_at)} (America/Chicago): {h.message}
                </Text>
              ))}
            </View>
          ))
        ) : (
          <Text style={ui.copy}>No verified linked requests.</Text>
        )}
      </Card>
      <Card appearance="storefront">
        <Text style={ui.copy}>
          Claim a guest request after sign-in. Staff must independently verify
          your identity and receipt before account access is granted.
        </Text>
        {input("claim_id", "Request ID")}
        {input("claim_token", "Private claim code")}
        <Button appearance="storefront"
          label="Request verified linking"
          disabled={busy}
          onPress={() => {
            if (submitting.current) return;
            const g = epoch.current;
            submitting.current = true;
            setBusy(true);
            void controller
              .claimServiceRequest(
                fields.claim_id ?? "",
                fields.claim_token ?? "",
                abort.current?.signal,
              )
              .then(() => {
                if (g === epoch.current)
                  setError(
                    "Claim saved for independent staff identity review.",
                  );
              })
              .catch(() => {
                if (g === epoch.current)
                  setError("Claim unavailable. Check the code and account.");
              })
              .finally(() => {
                if (g === epoch.current) {
                  submitting.current = false;
                  setBusy(false);
                }
              });
          }}
        />
      </Card>
    </View>
  );
}
const s = StyleSheet.create({
  stack: { gap: 20 },
  row: { gap: 10 },
  field: { gap: 6, marginVertical: 8 },

});
