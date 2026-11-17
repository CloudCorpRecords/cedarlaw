/**
 * cedarlaw forwarding tests. Every test runs against a
 * stubbed upstream (fake fetch); no live network call is
 * made anywhere in this suite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createClient,
  isKnownTool,
  parseRpcBody,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolResult,
} from "../src/types.js";

const FIXTURE_PATH = fileURLToPath(
  new URL(
    "../../../harness/fixtures/lebaneselegislation-tools-original.json",
    import.meta.url,
  ),
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

/**
 * Publish-survival guard (Wave 30 A preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}

/* ------------------------------------------------------------------ */
/* Fake upstream                                                       */
/* ------------------------------------------------------------------ */

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  /** Mcp-Session-Id the fake issues on initialize, if any. */
  sessionId?: string;
  /** Handler for the tools/call request; returns the raw reply. */
  onCall?: (params: Record<string, unknown>) => {
    status?: number;
    body: string;
  };
  /** Make the tools/call fetch itself throw. */
  throwOnCall?: boolean;
}

function resp(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function makeFakeUpstream(opts: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: { ...(init?.headers ?? {}) }, body });
    const method = body.method as string;
    if (method === "initialize") {
      const headers: Record<string, string> = {};
      if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
      return resp(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "lebaneselegislation", version: "1.0.0" },
          },
        }),
        200,
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return resp("", 202);
    }
    if (method === "tools/call") {
      if (opts.throwOnCall) throw new Error("socket hang up");
      const reply = opts.onCall
        ? opts.onCall(body.params as Record<string, unknown>)
        : {
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { content: [{ type: "text", text: "ok" }] },
            }),
          };
      return resp(reply.body, reply.status ?? 200);
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { fetchFn, calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ text?: unknown }>;
  return typeof content?.[0]?.text === "string" ? content[0].text : "";
}

/* ------------------------------------------------------------------ */
/* Registration integrity                                              */
/* ------------------------------------------------------------------ */

describe("registration integrity", () => {
  it("served tools/list deep-equals the fixture's 10 tools, in order", (t) => {
    if (skipWithoutFixture(t)) return;
    const fixturePath = fileURLToPath(
      new URL(
        "../../../harness/fixtures/lebaneselegislation-tools-original.json",
        import.meta.url,
      ),
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      tools: unknown[];
    };
    assert.equal(fixture.tools.length, 10);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
    assert.deepEqual(
      TOOL_NAMES,
      (fixture.tools as Array<{ name: string }>).map((t) => t.name),
    );
  });

  it("knows exactly the 10 captured tool names", () => {
    assert.deepEqual(TOOL_NAMES, [
      "search_legislation",
      "get_law",
      "get_article",
      "get_law_texts",
      "get_ruling",
      "get_gazette_issue",
      "get_links",
      "list_legislation",
      "list_gazette_issues",
      "possibly_affected",
    ]);
    assert.ok(isKnownTool("get_law"));
    assert.ok(!isKnownTool("delete_law"));
  });
});

/* ------------------------------------------------------------------ */
/* Wire behaviour                                                      */
/* ------------------------------------------------------------------ */

describe("forwarding wire", () => {
  it("opens a session (initialize, notifications/initialized) before tools/call and reuses it", async () => {
    const { fetchFn, calls } = makeFakeUpstream({ sessionId: "sess-9" });
    const client = createClient({ fetchFn, env: {} });
    await client.callTool("get_law", { id: 7 });
    await client.callTool("get_ruling", { id: 8 });
    assert.deepEqual(
      calls.map((c) => c.body.method),
      [
        "initialize",
        "notifications/initialized",
        "tools/call",
        "tools/call",
      ],
    );
    // Session id is honoured on later requests only.
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-9");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-9");
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-9");
  });

  it("never sends an Authorization header, under several environments", async () => {
    const envs: Array<Record<string, string | undefined>> = [
      {},
      { LEBANESELEGISLATION_MCP_URL: "https://example.test/mcp" },
      {
        AUTHORIZATION: "Bearer should-not-leak",
        Authorization: "Bearer also-not",
        LEBANESELEGISLATION_API_KEY: "key-not-sent",
        GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_not_sent",
      },
      { LEBANESELEGISLATION_MCP_URL: "https://lebaneselegislation.com/mcp" },
    ];
    for (const env of envs) {
      const { fetchFn, calls } = makeFakeUpstream();
      const client = createClient({ fetchFn, env });
      const result = await client.callTool("list_legislation", {});
      assert.notEqual(result.isError, true);
      assert.ok(calls.length >= 3);
      for (const call of calls) {
        for (const [k, v] of Object.entries(call.headers)) {
          assert.notEqual(k.toLowerCase(), "authorization");
          assert.ok(!String(v).includes("should-not-leak"));
          assert.ok(!String(v).includes("ghp_not_sent"));
          assert.ok(!String(v).includes("key-not-sent"));
        }
      }
    }
  });

  it("defaults to the pinned endpoint and honours the env override", async () => {
    const a = makeFakeUpstream();
    await createClient({ fetchFn: a.fetchFn, env: {} }).callTool("get_law", {
      id: 1,
    });
    assert.equal(a.calls[0].url, "https://lebaneselegislation.com/mcp");

    const b = makeFakeUpstream();
    await createClient({
      fetchFn: b.fetchFn,
      env: { LEBANESELEGISLATION_MCP_URL: " https://example.test/ll " },
    }).callTool("get_law", { id: 1 });
    assert.equal(b.calls[0].url, "https://example.test/ll");
  });

  it("forwards tool name and arguments verbatim", async () => {
    const { fetchFn, calls } = makeFakeUpstream();
    const args = {
      law_id: 244611,
      number: "586-1",
      nested: { list: [1, "two", null], flag: true },
    };
    await createClient({ fetchFn, env: {} }).callTool("get_article", args);
    const callReq = calls.find((c) => c.body.method === "tools/call");
    assert.ok(callReq);
    assert.deepEqual(callReq.body.params, {
      name: "get_article",
      arguments: args,
    });
    assert.equal(callReq.body.jsonrpc, "2.0");
  });
});

/* ------------------------------------------------------------------ */
/* Result handling                                                     */
/* ------------------------------------------------------------------ */

describe("result handling", () => {
  it("passes a successful upstream result through verbatim, extra fields included", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "المادة 212" }],
      structuredContent: { law_id: 5, articles: [1, 2] },
      extraField: "kept",
    };
    const { fetchFn } = makeFakeUpstream({
      onCall: () => ({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          result: upstreamResult,
        }),
      }),
    });
    // The fake echoes ids per request, so match is by position; the
    // result object must come back untouched.
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_law_texts",
      { law_id: 5 },
    );
    assert.deepEqual(result, upstreamResult);
  });

  it("passes an upstream isError result through verbatim instead of rewriting it", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "upstream says no" }],
      isError: true,
    };
    const { fetchFn } = makeFakeUpstream({
      onCall: (params) => ({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (params as unknown as { id?: number }).id ?? 3,
          result: upstreamResult,
        }),
      }),
    });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_ruling",
      { id: 3 },
    );
    // Returned as-is: local rendering would have prefixed the text.
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "upstream says no");
  });

  it("parses SSE replies and picks the message whose id matches the request", async () => {
    const { fetchFn } = makeFakeUpstream({
      onCall: () => ({
        body:
          "event: message\n" +
          'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
          "event: message\n" +
          'data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"from sse"}]}}\n\n',
      }),
    });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "search_legislation",
      { query: "670" },
    );
    assert.notEqual(result.isError, true);
    assert.equal(textOf(result), "from sse");
  });

  it("renders a JSON-RPC error as a cedarlaw error", async () => {
    const { fetchFn } = makeFakeUpstream({
      onCall: () => ({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32602, message: "bad law id" },
        }),
      }),
    });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_law",
      { id: -1 },
    );
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "cedarlaw error: bad law id");
  });

  it("renders a non-2xx status as a cedarlaw error", async () => {
    const { fetchFn } = makeFakeUpstream({
      onCall: () => ({ status: 503, body: "upstream down" }),
    });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_law",
      { id: 1 },
    );
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "cedarlaw error: HTTP 503");
  });

  it("renders a fetch failure on the call as a cedarlaw error", async () => {
    const { fetchFn } = makeFakeUpstream({ throwOnCall: true });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_law",
      { id: 1 },
    );
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "cedarlaw error: request failed: socket hang up");
  });

  it("renders a malformed reply as a cedarlaw error", async () => {
    const { fetchFn } = makeFakeUpstream({
      onCall: () => ({ body: "<html>not json</html>" }),
    });
    const result = await createClient({ fetchFn, env: {} }).callTool(
      "get_law",
      { id: 1 },
    );
    assert.equal(result.isError, true);
    assert.equal(textOf(result), "cedarlaw error: malformed response");
  });
});

/* ------------------------------------------------------------------ */
/* parseRpcBody                                                        */
/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses a plain JSON body and honours the expected id", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 4, result: {} });
    assert.equal(parseRpcBody(body, 4)?.id, 4);
    assert.equal(parseRpcBody("", 4), null);
    assert.equal(parseRpcBody("not json", 4), null);
  });

  it("extracts data: payloads from SSE framing", () => {
    const payload = { jsonrpc: "2.0", id: 2, result: { content: [] } };
    const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    assert.deepEqual(parseRpcBody(body, 2), payload);
  });
});

/* ------------------------------------------------------------------ */
/* MCP layer                                                           */
/* ------------------------------------------------------------------ */

describe("handleCallTool", () => {
  it("rejects unknown tools and non-object arguments before fetching", async () => {
    let fetched = false;
    const spy: FetchFn = async () => {
      fetched = true;
      throw new Error("must not be called");
    };
    const client = createClient({ fetchFn: spy, env: {} });
    await assert.rejects(
      () => handleCallTool(client, "nope", {}),
      /Unknown tool: nope/,
    );
    await assert.rejects(
      () => handleCallTool(client, "get_law", [1, 2]),
      /must be a JSON object/,
    );
    assert.equal(fetched, false);
  });

  it("forwards a known tool through the client", async () => {
    const { fetchFn } = makeFakeUpstream();
    const client = createClient({ fetchFn, env: {} });
    const result = await handleCallTool(client, "possibly_affected", {
      law_id: 12,
    });
    assert.equal(textOf(result), "ok");
  });
});

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

describe("CLI", () => {
  it("--version prints 0.1.0", () => {
    assert.equal(VERSION, "0.1.0");
    const buildRoot = fileURLToPath(new URL("..", import.meta.url));
    const cliPath = fileURLToPath(
      new URL("../src/cli.ts", import.meta.url),
    );
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", cliPath, "--version"],
      { cwd: buildRoot, encoding: "utf8" },
    );
    assert.equal(out.trim(), "0.1.0");
  });

  it("an unknown command prints Usage and exits 2", () => {
    const buildRoot = fileURLToPath(new URL("..", import.meta.url));
    const cliPath = fileURLToPath(
      new URL("../src/cli.ts", import.meta.url),
    );
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", cliPath, "not-a-tool"],
      { cwd: buildRoot, encoding: "utf8" },
    );
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Usage:/);
  });
});
