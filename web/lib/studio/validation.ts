import { actions, type Step } from "./model";

export function validateSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100)
    throw new Error("A test needs between 1 and 100 executable steps.");
  const steps = raw.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid step.");
    const s = value as Step;
    if (
      !actions.includes(s.action) ||
      typeof s.target !== "string" ||
      !s.target.trim()
    )
      throw new Error("Each step needs a supported action and a target.");
    for (const field of ["value", "expected"] as const)
      if (s[field] !== undefined && typeof s[field] !== "string")
        throw new Error(`${field} must be text.`);
    if (s.humanApproval !== undefined && typeof s.humanApproval !== "boolean")
      throw new Error("humanApproval must be a boolean.");
    if (
      (s.action.startsWith("assert") ||
        ["api", "database"].includes(s.action)) &&
      s.humanApproval
    )
      throw new Error(
        "Assertions must execute automatically; human approval cannot bypass verification.",
      );
    if (
      ["assertText", "assertURL", "api", "database"].includes(s.action) &&
      !s.expected?.trim()
    )
      throw new Error(`${s.action} needs an expected outcome.`);
    if (s.action === "assertValue" && s.expected === undefined)
      throw new Error(
        "assertValue needs an expected value (empty text is allowed).",
      );
    if (s.action === "assertVisible" && s.expected !== undefined)
      throw new Error(
        "Use assertText or assertValue to verify expected content; assertVisible only checks visibility.",
      );
    if (["fill", "select"].includes(s.action) && s.value === undefined)
      throw new Error(`${s.action} needs an explicit input value.`);
    if (s.action === "api" && !/^[1-5]\d{2}$/.test(s.expected!))
      throw new Error("API expected must be an HTTP status from 100 to 599.");
    if (s.action === "database" && !/^\d+$/.test(s.expected!))
      throw new Error("Database expected must be a nonnegative row count.");
    return s;
  });
  if (
    !steps.some(
      (s) =>
        s.action.startsWith("assert") || ["api", "database"].includes(s.action),
    )
  )
    throw new Error(
      "Every test needs a concrete UI, API, or database assertion.",
    );
  return steps;
}
