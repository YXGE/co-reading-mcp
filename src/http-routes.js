import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotatePassage,
  getProgress,
  listAnnotations,
  listBooks,
  listChunks,
  markRead,
  readChunk,
  replyToAnnotation,
  searchChunks,
  submitUserNotes,
} from "./store.js";
import { importBook } from "./importer.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(ROOT, "public");
const defaultMaxBodyBytes = Number(process.env.READING_HTTP_MAX_BODY_BYTES || process.env.READING_IMPORT_MAX_BYTES || 25_000_000);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export async function readBody(req, { maxBytes = defaultMaxBodyBytes, allowEmpty = true } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  if (!chunks.length) {
    if (allowEmpty) return {};
    throw new Error("Missing JSON body");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function routeParts(url) {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

export async function handleApi(req, res, url, options = {}) {
  const parts = routeParts(url);
  const maxBytes = options.maxBodyBytes || defaultMaxBodyBytes;

  if (req.method === "GET" && parts.length === 2 && parts[1] === "books") {
    return sendJson(res, 200, await listBooks());
  }

  if (req.method === "GET" && parts.length === 4 && parts[1] === "books" && parts[3] === "chunks") {
    return sendJson(res, 200, await listChunks(parts[2]));
  }

  if (req.method === "GET" && parts.length === 5 && parts[1] === "books" && parts[3] === "chunks") {
    return sendJson(res, 200, await readChunk(parts[2], parts[4]));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "annotations") {
    return sendJson(
      res,
      200,
      await listAnnotations({
        bookId: url.searchParams.get("bookId") || undefined,
        chunkId: url.searchParams.get("chunkId") || undefined,
        kind: url.searchParams.get("kind") || undefined,
        author: url.searchParams.get("author") || undefined,
        status: url.searchParams.get("status") || undefined,
        parentId: url.searchParams.has("parentId") ? url.searchParams.get("parentId") : undefined,
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "annotations") {
    const body = await readBody(req, { maxBytes });
    return sendJson(
      res,
      201,
      await annotatePassage({
        ...body,
        author: body.author || "user",
        status: body.status || "open",
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "replies") {
    const body = await readBody(req, { maxBytes });
    return sendJson(
      res,
      201,
      await replyToAnnotation({
        ...body,
        author: body.author || "user",
        kind: body.kind || "reply",
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "submit-notes") {
    return sendJson(res, 200, await submitUserNotes(await readBody(req, { maxBytes })));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "mark-read") {
    const body = await readBody(req, { maxBytes });
    return sendJson(res, 200, await markRead(body.bookId, body.chunkId));
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "import") {
    return sendJson(res, 201, await importBook(await readBody(req, { maxBytes })));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "progress") {
    return sendJson(res, 200, await getProgress(url.searchParams.get("bookId") || undefined));
  }

  if (req.method === "GET" && parts.length === 2 && parts[1] === "search") {
    return sendJson(
      res,
      200,
      await searchChunks({
        bookId: url.searchParams.get("bookId") || undefined,
        query: url.searchParams.get("q") || "",
        limit: Number(url.searchParams.get("limit") || 10),
      }),
    );
  }

  return sendError(res, 404, "Not found");
}

export async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "reader.html" : url.pathname.slice(1);
  const resolved = path.resolve(publicDir, requested);
  const relative = path.relative(publicDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return sendError(res, 403, "Forbidden");
  }

  try {
    const body = await readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(resolved)] || "application/octet-stream",
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return sendError(res, 404, "Not found");
    throw error;
  }
}
