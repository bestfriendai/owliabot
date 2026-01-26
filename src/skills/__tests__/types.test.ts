// src/skills/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import { skillManifestSchema } from "../types.js";

describe("skillManifestSchema", () => {
  it("should validate a valid manifest", () => {
    const manifest = {
      name: "crypto-price",
      version: "0.1.0",
      main: "index.js",
      owliabot: {
        tools: [
          {
            name: "get_price",
            description: "Get crypto price",
            parameters: {
              type: "object",
              properties: {
                coin: { type: "string", description: "Coin ID" },
              },
              required: ["coin"],
            },
            security: { level: "read" },
          },
        ],
      },
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("should reject manifest without owliabot field", () => {
    const manifest = {
      name: "crypto-price",
      version: "0.1.0",
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("should accept optional requires.env", () => {
    const manifest = {
      name: "crypto-balance",
      version: "0.1.0",
      owliabot: {
        requires: {
          env: ["ALCHEMY_API_KEY"],
        },
        tools: [],
      },
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
