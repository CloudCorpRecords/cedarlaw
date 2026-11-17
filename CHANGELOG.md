# Changelog

## 0.1.0 (2026-10-28)

First release.

- Forwarding client for the published Lebanese legislation MCP
  remote: all 10 captured tools are registered locally and every
  call is forwarded upstream over a streamable-HTTP JSON-RPC
  session, with upstream results returned verbatim.
- Tools: `search_legislation`, `get_law`, `get_article`,
  `get_law_texts`, `get_ruling`, `get_gazette_issue`, `get_links`,
  `list_legislation`, `list_gazette_issues`, `possibly_affected`.
- One bin serves a small CLI (`cedarlaw <tool> '<json-args>'`)
  and a stdio MCP server (`cedarlaw mcp`). No credentials are
  required and no Authorization header is ever sent upstream.
