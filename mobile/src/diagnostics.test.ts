import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindClientLogGateway,
  emitDiagnostic,
  flushDiagnostics,
} from "./diagnostics";

describe("mobile client logs", () => {
  it("queues until an agent gateway is bound, then posts there", async () => {
    const posts: { url: string; auth?: string; body: unknown }[] = [];
    const request = async (url: string, init?: RequestInit) => {
      posts.push({
        url,
        auth: (init?.headers as Record<string, string> | undefined)
          ?.Authorization,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(null, { status: 204 });
    };

    emitDiagnostic(
      "railway",
      "error",
      { op: "AgentTtsProjectDelete", message: "Not Authorized" },
      request,
    );
    assert.equal(posts.length, 0);

    bindClientLogGateway("https://agent.example/", "gateway-token");
    await flushDiagnostics();

    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "https://agent.example/v1/diagnostics");
    assert.equal(posts[0]?.auth, "Bearer gateway-token");
    const body = posts[0]?.body as {
      source: string;
      channel: string;
      event: string;
      details: Record<string, unknown>;
    };
    assert.equal(body.source, "mobile");
    assert.equal(body.channel, "railway");
    assert.equal(body.event, "error");
    assert.deepEqual(body.details, {
      op: "AgentTtsProjectDelete",
      message: "Not Authorized",
    });
  });
});
