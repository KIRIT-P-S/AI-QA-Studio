import { test } from "node:test";
import assert from "node:assert/strict";
import { clickRequiresHuman } from "../src/actionSafety";
import { validateSteps } from "../../web/lib/studio/validation";
import { testSchema } from "../../web/lib/studio/test-schema";
const origin = "https://www.amazon.in";
const search = {
  label: "Go",
  type: "submit",
  formMethod: "get",
  formAction: "https://www.amazon.in/s",
  isSearch: true,
};
test("Observed same-origin GET search is allowed", () =>
  assert.equal(clickRequiresHuman(search, origin), false));
test("POST and cross-origin forms still require a human", () => {
  assert.equal(
    clickRequiresHuman({ ...search, formMethod: "post" }, origin),
    true,
  );
  assert.equal(
    clickRequiresHuman(
      { ...search, formAction: "https://example.com/s" },
      origin,
    ),
    true,
  );
});
test("Purchase and unclassified submissions stay gated", () => {
  assert.equal(
    clickRequiresHuman({ ...search, label: "Buy now - checkout" }, origin),
    true,
  );
  assert.equal(
    clickRequiresHuman({ ...search, isSearch: false }, origin),
    true,
  );
  assert.equal(
    clickRequiresHuman(
      { ...search, label: "Delete item", type: "button" },
      origin,
    ),
    true,
  );
});
test("Input-value assertions need an expected value and cannot be bypassed", () => {
  assert.throws(() =>
    validateSteps([{ action: "assertValue", target: "#query" }]),
  );
  assert.throws(() =>
    validateSteps([
      {
        action: "assertValue",
        target: "#query",
        expected: "mouse",
        humanApproval: true,
      },
    ]),
  );
  assert.equal(
    validateSteps([
      { action: "assertValue", target: "#query", expected: "mouse" },
    ])[0].expected,
    "mouse",
  );
});
test("AI schema restricts requirement links to actual project IDs", () => {
  const schema = testSchema(["FR-real"]);
  assert.deepEqual(
    schema.properties.tests.items.properties.requirementIds.items.enum,
    ["FR-real"],
  );
});
