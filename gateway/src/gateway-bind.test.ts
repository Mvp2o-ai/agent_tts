import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayBindHost } from "./gateway-bind.js";

describe("gatewayBindHost", () => {
  it("defaults to all interfaces for container hosts", () => {
    assert.equal(gatewayBindHost(undefined), "0.0.0.0");
    assert.equal(gatewayBindHost(" "), "0.0.0.0");
  });

  it("accepts loopback for a host-local process", () => {
    assert.equal(gatewayBindHost("127.0.0.1"), "127.0.0.1");
    assert.equal(gatewayBindHost(" ::1 "), "::1");
  });

  it("rejects anything else", () => {
    assert.throws(() => gatewayBindHost("192.168.1.10"), /GATEWAY_BIND/);
    assert.throws(() => gatewayBindHost("localhost"), /GATEWAY_BIND/);
  });
});
