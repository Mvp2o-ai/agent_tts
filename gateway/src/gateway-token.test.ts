import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireGatewayToken } from "./gateway-token.js";

describe("requireGatewayToken", () => {
  it("rejects missing and common placeholder values", () => {
    for (const value of [
      undefined,
      "",
      "change-me",
      " CHANGEme ",
      "replace-me",
      "your-token-here",
    ]) {
      assert.throws(() => requireGatewayToken(value), /non-placeholder secret/);
    }
  });

  it("trims and accepts an operator-generated secret", () => {
    assert.equal(
      requireGatewayToken("  5bc52b352fcc13dd7f6a91ee86e05591  "),
      "5bc52b352fcc13dd7f6a91ee86e05591",
    );
  });
});
