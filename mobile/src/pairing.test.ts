import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentPairingUrl, parseAgentPairingUrl } from "./pairing";

describe("agent setup links", () => {
  it("round-trips a versioned gateway pairing payload", () => {
    const link = buildAgentPairingUrl({
      gatewayUrl: "https://agent.example.com/",
      gatewayToken: "secret-token",
      name: "API agent",
    });

    assert.deepEqual(parseAgentPairingUrl(link), {
      gatewayUrl: "https://agent.example.com",
      gatewayToken: "secret-token",
      name: "API agent",
    });
  });

  it("accepts a local HTTP endpoint for manual deployments", () => {
    const payload = parseAgentPairingUrl(
      "agenttts://pair?v=1&url=http%3A%2F%2F10.0.0.8%3A4100&token=token",
    );

    assert.equal(payload?.gatewayUrl, "http://10.0.0.8:4100");
  });

  it("rejects malformed, unsupported, and unversioned links", () => {
    assert.equal(parseAgentPairingUrl("not a url"), null);
    assert.equal(
      parseAgentPairingUrl(
        "agenttts://pair?v=1&url=javascript%3Aalert(1)&token=x",
      ),
      null,
    );
    assert.equal(
      parseAgentPairingUrl(
        "agenttts://pair?url=https%3A%2F%2Fagent.example.com&token=x",
      ),
      null,
    );
    assert.equal(
      parseAgentPairingUrl(
        "agenttts://other?v=1&url=https%3A%2F%2Fagent.example.com&token=x",
      ),
      null,
    );
  });
});
