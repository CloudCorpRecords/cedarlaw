# BUILD-REPORT — cedarlaw

Rebuild of `com.lebaneselegislation/mcp` v1.0.0 (remote-only MCP
server at `https://lebaneselegislation.com/mcp`), Lane B Batch B4.
Clean-room forwarding client, built 2026-10-28.

## Surface built

Full surface: 10 of 10 captured tools, registered exactly as the
fixture literals via the MCP SDK low-level Server API
(`ListToolsRequestSchema` / `CallToolRequestSchema` handlers in
`src/mcp.ts`), with `tools/list` answered locally from
`TOOL_DEFS` in `src/forward.ts`:

`search_legislation`, `get_law`, `get_article`, `get_law_texts`,
`get_ruling`, `get_gazette_issue`, `get_links`,
`list_legislation`, `list_gazette_issues`, `possibly_affected`.

The tool literals (name, description, inputSchema — exactly the
three keys the capture carries per tool) were generated
programmatically from
`harness/fixtures/lebaneselegislation-tools-original.json` by a
generator script in `/tmp/laneb4-cedarlaw-scratch/`
(`gen-tools.mjs`: parse the fixture, re-serialise each tool
object, splice into `forward.ts`). No schema JSON was retyped
by hand.

Full 19-file factory set per TEMPLATE.md: `package.json`,
`server.json`, `Dockerfile`, `tsconfig.json`, `.gitignore`,
`package-lock.json`, `README.md` (written fresh), `LICENSE`
(MIT, Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single
0.1.0 entry), `src/{index,cli,mcp,types,forward}.ts`,
`test/forward.test.ts`, and
`.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
(publish-container IMAGE `ghcr.io/cloudcorprecords/cedarlaw`,
smoke test asserts server name `cedarlaw`).

Wire: pinned upstream `https://lebaneselegislation.com/mcp`;
streamable-HTTP JSON-RPC forwarding (initialize →
notifications/initialized → tools/call, session opened lazily
and reused, `Mcp-Session-Id` honoured when issued); plain-JSON
and SSE replies parsed, the message whose id matches the
request wins; upstream results pass through verbatim (isError
flag and extra fields included). No `Authorization` header is
ever sent — the registry record declares no headers. The
forwarding core takes an injectable fetch (`ForwardDeps`).

Identity: npm `@reneturcios/cedarlaw`, `mcpName`
`io.github.CloudCorpRecords/cedarlaw`, bin `cedarlaw` →
`dist/cli.js`, version 0.1.0 everywhere (package.json,
server.json top-level + npm entry, OCI tag, `VERSION`,
CHANGELOG heading). Dockerfile: `node:20-alpine` in both
stages, ENTRYPOINT `node /app/dist/cli.js`, CMD `mcp`, label
`io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/cedarlaw"`.

## Fixture conflicts

None. The spec's required-field summary matches the fixture
for all 10 tools (including `list_legislation` and
`list_gazette_issues` carrying no `required` key), and the
fixture's three-keys-per-tool shape was preserved verbatim.

## Labelled reconstructions

- Env override `LEBANESELEGISLATION_MCP_URL` for the pinned
  upstream endpoint (a reconstruction; the published remote
  is the default).
- Failure rendering as an isError result whose text begins
  `cedarlaw error:` (upstream JSON-RPC error message, `HTTP
  <status>`, `request failed: <message>`, or `malformed
  response`).
- The CLI surface (`cedarlaw <tool> '<json-args>'`,
  `--version`, exit codes 0/1/2) follows the fleet template;
  the original is remote-only and publishes no CLI.

## Lockfile

Route 3, clean from birth: generated in the build directory
with no `node_modules` present via
`npm install --package-lock-only --ignore-scripts --offline`,
then populated with `npm ci --ignore-scripts --offline`.
Verified: parses as JSON, `name` == `@reneturcios/cedarlaw`,
exactly **128** package entries.
SHA-256: `0956f1ae56fa60567764682c2b1bf6d7e82ea25cf92aa31ec47f6a4a8e9e13af`

## server.json description

"Lebanese legislation corpus: laws, articles, rulings and Gazette issues, verbatim." — **82 characters**.
The npm package entry carries `"version": "0.1.0"`; the OCI
entry (`ghcr.io/cloudcorprecords/cedarlaw:0.1.0`) carries NO
`version` field (verified programmatically).

## Verification results (own run)

- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `npm test` — **19 tests, 19 pass, 0 fail** (fake-fetch only;
  no live network calls). Coverage: registration integrity
  (served tools/list deep-equals the fixture's 10 tools, in
  order), session lifecycle + `Mcp-Session-Id` reuse,
  no-Authorization-header assertions under four environments
  (including envs carrying unrelated credential-shaped
  variables), pinned default endpoint + env override, verbatim
  argument forwarding, result pass-through incl. extra fields,
  upstream `isError` pass-through, SSE parsing with id
  matching, error rendering (JSON-RPC error, HTTP 503, fetch
  throw, malformed body), `parseRpcBody` units, MCP-layer
  validation (unknown tool / non-object args rejected before
  any fetch), CLI behaviour (`--version` prints `0.1.0`;
  unknown command prints Usage, exit 2).
- Parity:
  `python3 harness/parity.py --original harness/fixtures/lebaneselegislation-tools-original.json --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/cedarlaw/dist/cli.js mcp" --out builds/cedarlaw/parity-out`
  → **verdict PASS, parity 100.0** (10/10 tools identical, no
  missing, no extra, no schema diffs). Report in `parity-out/`.
- Built CLI check: `node dist/cli.js --version` prints `0.1.0`.
