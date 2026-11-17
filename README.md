# cedarlaw

An MCP server for the Lebanese legislation corpus: laws, decrees and
decisions, their verbatim article texts, court rulings, Official
Gazette issues, and the citation and amendment graph between them.

cedarlaw keeps no copy of the corpus. It is a forwarding client for
the published Lebanese legislation MCP remote: the ten tools are
registered locally with the exact definitions captured from the
upstream server, and each call is forwarded upstream over a
streamable-HTTP JSON-RPC session. Whatever the upstream returns —
text, structured fields, an `isError` flag — is handed back exactly
as received. The corpus itself is published legal text only; the
upstream descriptions note throughout that it is not legal advice.

No account and no credentials are involved: the upstream record
declares no headers, and cedarlaw never sends an `Authorization`
header.

## Tools

| Tool | What it does |
| --- | --- |
| `search_legislation` | Keyword search across laws, articles, rulings and Gazette issues (Arabic, French or English). |
| `get_law` | One text's metadata, table of contents, article list and amendment relations. |
| `get_article` | One article's verbatim in-force text, status and amendment history. |
| `get_law_texts` | The verbatim texts of a law's articles, one page at a time. |
| `get_ruling` | One court ruling: court, number, date, panel and its text or scan reading. |
| `get_gazette_issue` | One Official Gazette issue and the texts it published. |
| `get_links` | Citation and amendment edges into or out of a law, article, ruling or issue. |
| `list_legislation` | Laws, decrees and decisions listed by publication date. |
| `list_gazette_issues` | Gazette issues listed by publication date. |
| `possibly_affected` | General-repeal clauses that may touch a given law. |

## Usage

Run the stdio MCP server:

```bash
npx -y @reneturcios/cedarlaw mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "cedarlaw": {
      "command": "npx",
      "args": ["-y", "@reneturcios/cedarlaw", "mcp"]
    }
  }
}
```

Or call a single tool from the command line, passing its arguments
as one JSON object string:

```bash
npx -y @reneturcios/cedarlaw search_legislation '{"query":"670"}'
npx -y @reneturcios/cedarlaw get_article '{"law_id":244611,"number":"212"}'
cedarlaw --version
```

Exit codes: 0 on success, 1 when the forwarded result is an error,
2 on usage errors.

With Docker:

```bash
docker run -i ghcr.io/cloudcorprecords/cedarlaw
docker run --rm ghcr.io/cloudcorprecords/cedarlaw get_law '{"id":244611}'
```

## Configuration

The upstream endpoint is pinned to `https://lebaneselegislation.com/mcp`.
It can be replaced with the `LEBANESELEGISLATION_MCP_URL` environment
variable (a labelled reconstruction; the published remote is the
default and needs no configuration).

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # fake-fetch tests only; no live network
npm run dev     # run the CLI from source
```

## License

MIT. See `LICENSE`.
