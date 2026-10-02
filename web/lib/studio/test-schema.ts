import { actions } from "./model";
export function testSchema(ids: string[]) {
  return {
    type: "object",
    required: ["tests"],
    properties: {
      tests: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          required: ["title", "expected", "requirementIds", "steps"],
          properties: {
            title: { type: "string" },
            expected: { type: "string" },
            kind: { type: "string" },
            requirementIds: {
              type: "array",
              items: { type: "string", enum: ids },
            },
            steps: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                required: ["action", "target"],
                properties: {
                  action: { type: "string", enum: actions },
                  target: { type: "string" },
                  value: { type: "string" },
                  expected: { type: "string" },
                  humanApproval: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  };
}
