import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  railwayGraphql,
  RailwayApiError,
} from "./providers/railway/graphql";

describe("Railway GraphQL transport", () => {
  it("uses bearer authorization and returns typed data", async () => {
    const data = await railwayGraphql<{ viewer: { id: string } }>(
      "oauth-access",
      "query Viewer { viewer { id } }",
      { include: true },
      async (_url, init) => {
        assert.equal(
          (init?.headers as Record<string, string>).authorization,
          "Bearer oauth-access",
        );
        assert.deepEqual(JSON.parse(String(init?.body)), {
          query: "query Viewer { viewer { id } }",
          variables: { include: true },
        });
        return Response.json({ data: { viewer: { id: "user-1" } } });
      },
    );

    assert.equal(data.viewer.id, "user-1");
  });

  it("treats GraphQL errors in HTTP 200 responses as failures", async () => {
    await assert.rejects(
      () =>
        railwayGraphql(
          "oauth-access",
          "mutation Launch { launch }",
          {},
          async () =>
            Response.json({
              data: null,
              errors: [
                {
                  message: "not permitted",
                  extensions: {
                    code: "FORBIDDEN",
                    traceId: "trace-1",
                  },
                },
              ],
            }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof RailwayApiError);
        assert.equal(error.message, "not permitted");
        assert.equal(error.code, "FORBIDDEN");
        assert.equal(error.traceId, "trace-1");
        return true;
      },
    );
  });

  it("exposes rate-limit delay without leaking request variables", async () => {
    await assert.rejects(
      () =>
        railwayGraphql(
          "oauth-access",
          "query Secret($value: String!) { me { id } }",
          { value: "do-not-leak" },
          async () =>
            Response.json(
              { errors: [{ message: "rate limited" }] },
              { status: 429, headers: { "retry-after": "12" } },
            ),
        ),
      (error: unknown) => {
        assert.ok(error instanceof RailwayApiError);
        assert.equal(error.retryAfterSeconds, 12);
        assert.equal(error.message.includes("do-not-leak"), false);
        return true;
      },
    );
  });
});
