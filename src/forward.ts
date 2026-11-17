/**
 * cedarlaw core: a forwarding client for the hosted
 * Lebanese legislation MCP server.
 *
 * No legislation data lives on this machine. tools/list
 * is answered from the literal definitions below, which
 * reproduce a live capture of the upstream server word
 * for word (name, description and inputSchema exactly
 * as captured; the capture carries exactly those three
 * keys per tool). A tools/call travels upstream over a
 * streamable-HTTP JSON-RPC session: an initialize POST,
 * a notifications/initialized POST, then the tools/call
 * POST, carrying the Mcp-Session-Id response header on
 * later requests when the upstream issues one. The
 * session opens lazily on the first forwarded call and
 * is reused for the client's lifetime.
 *
 * The endpoint is pinned to
 * https://lebaneselegislation.com/mcp and may be
 * replaced with the LEBANESELEGISLATION_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). The registry record declares NO
 * headers on the upstream remote, so no Authorization
 * header is ever sent, under any environment.
 *
 * A successful upstream result is returned exactly as
 * received, isError flag and extra fields included.
 * Failures — an upstream JSON-RPC error, a non-2xx
 * status, a body that cannot be parsed, or a fetch
 * that throws or times out — become an isError result
 * whose text begins with `cedarlaw error:` (that
 * rendering is a labelled reconstruction). Replies may
 * be plain JSON or SSE (`data:` lines); the JSON-RPC
 * message whose id matches the request wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://lebaneselegislation.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/                                       */
/* lebaneselegislation-tools-original.json; generated                 */
/* programmatically by parsing and re-serialising the fixture JSON,   */
/* never retyped)                                                     */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "search_legislation",
    "description": "Search Lebanese legislation (laws, decrees, decisions), their articles, court rulings, or Official Gazette issues, by keyword: Arabic words, French words (articles the Centre published in French, and the codes' French or English names), or a law's numeric id. Returns verbatim snippets from the Lebanese University's database, never an AI-written summary. A ruling hit's pdf_url is its full judgment's scan on the Lebanese University's site: always pass it on with any answer that cites the ruling. English words work too: they are read into Arabic through a glossary, matched against the unofficial English titles, and when nothing matches the result says what was searched instead (searched_instead). A code named in the query (\"قانون العقوبات 670\", \"أصول محاكمات مدنية صورية\") narrows the articles to that code; when none of its articles holds the other words, articles_not_in_code names it and the articles listed are from other texts. Each law carries title_en, an unofficial English title a model wrote from the Arabic title alone: the Arabic title and text are official and more accurate; cite the Arabic. A search of the gazette category with a bare year (\"2025\") lists that year's issues, and \"22/2025\" is issue 22 of 2025; to list texts by date use list_legislation instead. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "words to search for, Arabic, English or French, or a law's id"
        },
        "kind": {
          "type": "string",
          "enum": [
            "laws",
            "articles",
            "rulings",
            "gazette"
          ],
          "description": "narrow to one category; omit to search all four"
        },
        "year": {
          "type": "integer",
          "description": "only laws issued this year; for the gazette category, only issues published this year"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 10,
          "description": "results per category, at most 20"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_law",
    "description": "Get a law, decree or similar text's metadata (kind, number, date, status), its table of contents (the chapters: id, parent_id, depth, heading), its articles in order (number, and the section_id of the chapter each sits under) and the texts it amended or was amended by (amended_by / amended: one entry per text and relation, with articles listing the articles of this law it touches, or of the other law for amended; no articles means the whole law). Use get_article to read one article's verbatim text, or get_law_texts to read all of them. title_en is an unofficial English title (a model's rendering of the Arabic one); the Arabic title and text are official and more accurate. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "description": "the law's numeric id, from search_legislation or its URL"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "get_article",
    "description": "Get one article's verbatim Arabic text as in force today (and French, when the Centre published it and no amendment has replaced it), its in-force status, amendment history, and the canonical and source URLs. When an amendment replaced the wording, text_ar is the new wording and centre_text_ar the earlier one the Centre's site still shows. centre_error, when present, notes an error in the Centre's own text (one article repeating another, a stray letter); the text itself is left as published. The text is copied exactly from the database; nothing here is AI-written. Laws with ids from 2000000000 are ones the Lebanese University has not published yet, read by machine from scans of the Official Gazette's pages (unofficial copies, page images on the law's page); where the two readings differ the text shows both as ⟦reading one | reading two⟧: quote neither as certain. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "law_id": {
          "type": "integer",
          "description": "the law's id (see get_law)"
        },
        "number": {
          "type": "string",
          "description": "the article's printed number, e.g. \"212\", \"12 مكرر\" or \"586-1\" (an article numbered under another; \"586 (1)\" works too)"
        }
      },
      "required": [
        "law_id",
        "number"
      ]
    }
  },
  {
    "name": "get_law_texts",
    "description": "Get the verbatim texts of a law's articles in order, a page at a time: for each article its number, section_id, note, and the same text fields as get_article (text_ar in force today, text_fr, centre_text_ar when an amendment replaced the wording, version, repealed). Follow next_offset until it is absent to read the whole law. Amendment history stays in get_article. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "law_id": {
          "type": "integer",
          "description": "the law's numeric id"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "how many articles to skip (next_offset of the previous page)"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200,
          "default": 50,
          "description": "articles per page, at most 200"
        }
      },
      "required": [
        "law_id"
      ]
    }
  },
  {
    "name": "get_ruling",
    "description": "Get one court ruling (judgment) by id: court, number, date, panel, and its verbatim text when the Centre holds it as typed text. When available, pages returns the scanned judgment's machine reading, with low_confidence: true on hard-to-read pages where errors are expected. pdf_url is the full judgment's scan on the Lebanese University's site: always give it to the user with any answer about the ruling, so they can open the original. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "description": "the ruling's numeric id, from search_legislation"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "get_gazette_issue",
    "description": "Get one Official Gazette issue by id: its number, publication date, and the laws, decrees and decisions it published. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "description": "the issue's numeric id, from search_legislation"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "get_links",
    "description": "Get the graph edges into or out of one item: a law, an article, a ruling, an opinion, a research study or a Gazette issue. Use this to walk citations and amendments directly, instead of only what get_law and get_article attach automatically. For a law key (\"law/<id>\") the default scope \"all\" includes the edges of its articles too (each link keeps its real to_key, e.g. \"law/244611/art/37\"); scope \"law\" is the law itself only. Newest first by the date of the text each edge comes from; page with offset and next_offset, total is the number of edges. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "description": "the item's key: \"law/<id>\", \"law/<id>/art/<number>\", \"ruling/<id>\", \"opinion/<id>\", \"research/<id>\" or \"gazette/<id>\""
        },
        "direction": {
          "type": "string",
          "enum": [
            "to",
            "from"
          ],
          "default": "to",
          "description": "\"to\" (edges that name this item as their target) or \"from\" (edges this item itself carries)"
        },
        "relation": {
          "type": "string",
          "description": "narrow to one relation (e.g. \"cites\", \"amend\", \"repeal\"); omit for all"
        },
        "scope": {
          "type": "string",
          "enum": [
            "all",
            "law"
          ],
          "description": "for a law key only: \"all\" (default) adds the edges to or from its articles, \"law\" is the law itself only"
        },
        "order": {
          "type": "string",
          "enum": [
            "newest",
            "oldest"
          ],
          "default": "newest",
          "description": "by the date of the text the edge comes from (Gazette date, else issue date)"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "how many edges to skip (next_offset of the previous page)"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200,
          "default": 50,
          "description": "at most this many edges. quote is cut to 600 characters when longer (quote_truncated: true); get_article has the full wording"
        }
      },
      "required": [
        "key"
      ]
    }
  },
  {
    "name": "list_legislation",
    "description": "List laws, decrees and decisions by date, newest first: for \"everything published since January 2025\" call with since \"2025-01\". The date is the publication date: the Official Gazette date, else the issue date (each entry's date, with gazette_number, gazette_date and gazette_issue_id). Recent texts come from machine readings of Gazette scans (ids from 2000000000, unofficial) because the Lebanese University's Centre lags about a year, so a recent period lists mostly those. since and until accept YYYY, YYYY-MM or YYYY-MM-DD, inclusive. kind narrows to one kind, in Arabic (\"قانون\", \"مرسوم\") or English (\"Law\", \"Decree\"). Page with offset and next_offset; total is the whole count. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "since": {
          "type": "string",
          "description": "first date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD (e.g. \"2025-01\")"
        },
        "until": {
          "type": "string",
          "description": "last date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD"
        },
        "kind": {
          "type": "string",
          "description": "the kind of text, Arabic or English (e.g. \"قانون\" or \"Law\", \"Decree\")"
        },
        "order": {
          "type": "string",
          "enum": [
            "newest",
            "oldest"
          ],
          "default": "newest",
          "description": "by publication date"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "how many texts to skip (next_offset of the previous page)"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "default": 50,
          "description": "texts per page, at most 100"
        }
      }
    }
  },
  {
    "name": "list_gazette_issues",
    "description": "List Official Gazette issues by publication date, newest first, with the number of texts each carries (text_count) and where the issue comes from: source \"centre\" (the Lebanese University's Centre, whose issues stop about a year back) or \"scans\" (issues seen in Gazette scans, ids from 2000000000, which cover recent months). since and until accept YYYY, YYYY-MM or YYYY-MM-DD, inclusive; \"everything since January 2025\" is since \"2025-01\". Page with offset and next_offset. get_gazette_issue reads one issue's texts. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "since": {
          "type": "string",
          "description": "first date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD"
        },
        "until": {
          "type": "string",
          "description": "last date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD"
        },
        "order": {
          "type": "string",
          "enum": [
            "newest",
            "oldest"
          ],
          "default": "newest",
          "description": "by publication date"
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "default": 0,
          "description": "how many issues to skip (next_offset of the previous page)"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "default": 50,
          "description": "issues per page, at most 100"
        }
      }
    }
  },
  {
    "name": "possibly_affected",
    "description": "Get the general repeals that may touch a law: earlier texts with a \"all provisions contrary to this law are repealed\" clause pointing at it. A list to check, never a finding that anything was actually repealed. Not legal advice.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "law_id": {
          "type": "integer",
          "description": "the law's numeric id"
        }
      },
      "required": [
        "law_id"
      ]
    }
  },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` belongs to the captured surface. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `cedarlaw error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Read a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * present, otherwise the last parseable message, otherwise
 * null when nothing in the body parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON payload; skip this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding a single upstream session,
 * opened lazily on first use and reused from then on
 * (for the process lifetime in the MCP server, or for a
 * single invocation in the CLI).
 */
export class CedarlawClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).LEBANESELEGISLATION_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    // The registry record declares NO headers on the upstream
    // remote: no Authorization header is ever sent.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "cedarlaw", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // Nothing needed from the notification response body.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Hand the upstream result back exactly as received.
    return result;
  }
}

/** Build a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): CedarlawClient {
  return new CedarlawClient(deps);
}

/** One-shot helper: a fresh client for a single call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new CedarlawClient(deps).callTool(name, args);
}
