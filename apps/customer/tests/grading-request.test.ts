import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredGradingProviders,
  gradingRequestSelection,
} from "../../../packages/customer-contracts/src/grading-request";

const psa = {
  id: "89dad276-1fc7-4cd4-9aee-fd031036e9ea",
  provider: "PSA" as const,
  name: "SAMPLE configured service",
  declared_value_limit_cents: 50000,
};
const config = { serviceLevels: [psa] };
const preference = {
  provider: "PSA" as const,
  service_level_id: psa.id,
  declared_value_cents: 50000,
};

test("grading request offers only providers present in current configuration", () => {
  assert.deepEqual(configuredGradingProviders({ serviceLevels: [] }), []);
  assert.deepEqual(
    configuredGradingProviders({
      serviceLevels: [psa, { ...psa, id: "another" }],
    }),
    ["PSA"],
  );
  assert.deepEqual(
    configuredGradingProviders({
      serviceLevels: [psa, { ...psa, id: "another", provider: "SGC" }],
    }),
    ["PSA", "SGC"],
  );
});
test("grading request preserves staff review without inventing an available service or fees", () => {
  const result = gradingRequestSelection(
    { serviceLevels: [] },
    { ...preference, service_level_id: null, declared_value_cents: null },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.serviceLevel, null);
  assert.match(result.summary, /preferences pending confirmation/);
  assert.match(result.summary, /fees remain unquoted/);
  assert.match(
    result.summary,
    /does not record physical receipt, take payment or submit cards/,
  );
});
test("grading request rejects retired and mismatched configured service identities", () => {
  for (const [current, selection] of [
    [{ serviceLevels: [] }, preference],
    [config, { ...preference, provider: "SGC" as const }],
    [config, { ...preference, service_level_id: "unknown" }],
  ] as const) {
    const result = gradingRequestSelection(current, selection);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "service_unavailable");
  }
});
test("grading request enforces exact declared-value limit and distinguishes unset from configured zero", () => {
  const zero = { serviceLevels: [{ ...psa, declared_value_limit_cents: 0 }] };
  assert.equal(gradingRequestSelection(config, preference).ok, true);
  for (const [current, selection, code] of [
    [
      config,
      { ...preference, declared_value_cents: null },
      "declared_value_required",
    ],
    [
      config,
      { ...preference, declared_value_cents: 50001 },
      "declared_value_exceeded",
    ],
    [
      zero,
      { ...preference, declared_value_cents: 1 },
      "declared_value_exceeded",
    ],
  ] as const) {
    const result = gradingRequestSelection(current, selection);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
  }
  assert.equal(
    gradingRequestSelection(zero, { ...preference, declared_value_cents: 0 })
      .ok,
    true,
  );
  assert.equal(
    gradingRequestSelection(
      { serviceLevels: [{ ...psa, declared_value_limit_cents: null }] },
      { ...preference, declared_value_cents: null },
    ).ok,
    true,
  );
});
test("grading request rejects invalid monetary input and never promises a grade, turnaround or charge", () => {
  for (const value of [
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    100000001,
  ]) {
    const result = gradingRequestSelection(config, {
      ...preference,
      declared_value_cents: value,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_declared_value");
  }
  const result = gradingRequestSelection(config, preference);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.serviceLevel, psa);
  assert.match(
    result.summary,
    /SAMPLE configured service requested for staff review/,
  );
  assert.match(result.summary, /Fees remain unquoted/);
  assert.match(
    result.summary,
    /does not record physical receipt, take payment or submit cards/,
  );
});
