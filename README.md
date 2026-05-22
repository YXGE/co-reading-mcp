# Co-Reading MCP

A local MCP server that gives Claude a durable reading room:

- import EPUB or plain text into stable chunks while preserving EPUB spine/chapter boundaries
- list books and chunks
- read chunk-by-chunk with `prevId` / `nextId`
- search across a book with cached chunk text
- write margin annotations
- stage user notes, submit them to Claude once, and attach Claude replies under them
- track reading progress

The goal is not one-shot summarization. The goal is a shared reading surface where a human and Claude can both read, leave anchored notes, and resume smoothly.

## Quick Start

Requirements:

- Node.js 18+
- Python 3.10+ for the import scripts

```bash
cd co-reading-mcp
cp -R data.example data
node src/server.js
```

If you also want a human-friendly reading surface, start the bundled reader:

```bash
npm run reader
```

Open `http://127.0.0.1:8787`. This serves a small reference reader and local HTTP API while also keeping the MCP stdio server active in the same process. In Claude Desktop / Claude Code you can point the MCP command at `src/http.js` instead of `src/server.js` when you want one process to handle both:

```json
{
  "mcpServers": {
    "co-reading": {
      "command": "node",
      "args": ["/absolute/path/to/co-reading-mcp/src/http.js"],
      "env": {
        "READING_MCP_DATA_DIR": "/absolute/path/to/co-reading-mcp/data",
        "READING_HTTP_PORT": "8787"
      }
    }
  }
}
```

For Claude Desktop / Claude Code, configure the MCP server as a stdio command:

```json
{
  "mcpServers": {
    "co-reading": {
      "command": "node",
      "args": ["/absolute/path/to/co-reading-mcp/src/server.js"],
      "env": {
        "READING_MCP_DATA_DIR": "/absolute/path/to/co-reading-mcp/data"
      }
    }
  }
}
```

## Remote SSE Transport

For VPS, reverse-proxy, tunnel, or remote MCP clients that support SSE transport, run:

```bash
READING_MCP_DATA_DIR=./data MCP_AUTH_TOKEN="change-me" npm run start:sse
```

The SSE endpoint is:

```text
https://your-domain.example/sse
```

Environment variables:

- `MCP_SSE_PORT` or `PORT`: listen port, default `3100`
- `MCP_SSE_HOST`: listen host, default `0.0.0.0`
- `MCP_AUTH_TOKEN`: bearer token required by remote clients
- `MCP_CORS_ORIGIN`: CORS origin, default `*`
- `MCP_MAX_BODY_BYTES`: max JSON-RPC POST body size, default `1000000`

Do not expose the SSE server on the public internet without HTTPS and `MCP_AUTH_TOKEN`. If you use nginx, Caddy, or cloudflared, proxy `/sse` and `/messages` to the same local process and make sure streaming responses are not buffered.

## Import Books

Plain text:

```bash
python3 scripts/import_text.py ./book.txt --title "Book Title" --author "Author" --out ./data/books
```

Plain text can also preserve section headings with a multiline regex:

```bash
python3 scripts/import_text.py ./book.txt \
  --title "Book Title" \
  --heading-regex "^第[一二三四五六七八九十百零〇0-9]+[章节回].*$"
```

EPUB:

```bash
python3 scripts/import_epub.py ./book.epub --out ./data/books
```

Both importers create:

```text
data/books/<book-id>/
  manifest.json
  chunks/
    ch00.txt
    ch01.txt
```

EPUB imports keep each spine item as a section boundary. If an EPUB stores the whole book in a single spine item, the importer falls back to internal `h1`/`h2`/`h3` headings. If a chapter is longer than `--max-chars`, only that chapter is split into `Chapter Title Part 1/N`, `Part 2/N`, and so on.

Runtime state is stored outside book content:

```text
data/
  annotations.jsonl
  progress.json
  reading_sessions.json
```

`reading_submit_user_notes` includes full chunk text once per `sessionId` by default, then sends only new notes for the same chunk in that session. Use a new `sessionId` when Claude starts a new conversation/session so the relevant chunk context is sent again.

## Tools

- `reading_list_books`
- `reading_list_chunks`
- `reading_read_chunk`
- `reading_search_chunks`
- `reading_annotate_passage`
- `reading_list_annotations`
- `reading_submit_user_notes`
- `reading_reply_to_annotation`
- `reading_mark_read`
- `reading_get_progress`

See [docs/mcp-tools.md](docs/mcp-tools.md) and [docs/data-format.md](docs/data-format.md).
For the intended Claude workflow, see [docs/claude-workflow.md](docs/claude-workflow.md).

## Frontend Integration

The bundled reader is intentionally small: it is a reference UI, not a required frontend. Existing apps can talk to the same local HTTP API:

- `GET /api/books`
- `GET /api/books/:bookId/chunks`
- `GET /api/books/:bookId/chunks/:chunkId`
- `GET /api/annotations?bookId=...&chunkId=...`
- `POST /api/annotations`
- `POST /api/submit-notes`
- `POST /api/mark-read`
- `GET /api/search?q=...&bookId=...`

Human notes are saved as open local notes first. Pressing "Send to Claude" calls `reading_submit_user_notes`, includes chunk context according to the session policy, marks those notes submitted, and avoids resending the same open notes.

## Privacy

This repo is designed so private content stays in `data/`, which is ignored by git. `data.example/` contains only toy text.

## Contributors

Created by Koshi with Claude and GPT.
