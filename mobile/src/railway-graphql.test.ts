import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRailwayAuthorizationFailure,
  isRailwayResourceDenied,
  isRailwaySessionExpired,
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

  it("identifies expired sessions separately from resource denials", () => {
    assert.equal(
      isRailwaySessionExpired(
        new RailwayApiError("request rejected", { status: 401 }),
      ),
      true,
    );
    assert.equal(
      isRailwayResourceDenied(new RailwayApiError("Not Authorized")),
      true,
    );
    assert.equal(
      isRailwaySessionExpired(new RailwayApiError("Not Authorized")),
      false,
    );
    assert.equal(
      isRailwayAuthorizationFailure(new RailwayApiError("Not Authorized")),
      true,
    );
    assert.equal(
      isRailwayAuthorizationFailure(
        new RailwayApiError("not permitted", { code: "FORBIDDEN" }),
      ),
      true,
    );
    assert.equal(
      isRailwayAuthorizationFailure(new Error("network request failed")),
      false,
    );
  });

  it("attaches the GraphQL operation name to failures", async () => {
    await assert.rejects(
      () =>
        railwayGraphql(
          "oauth-access",
          "mutation AgentTtsProjectDelete($id: String!) { projectDelete(id: $id) }",
          { id: "project-1" },
          async () =>
            Response.json({
              data: null,
              errors: [{ message: "Not Authorized" }],
            }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof RailwayApiError);
        assert.equal(error.operation, "AgentTtsProjectDelete");
        assert.equal(error.resources?.id, "project-1");
        return true;
      },
    );
  });
});
