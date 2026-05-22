// Bun → Node transport bridge.
//
// The Bun original ran `Bun.serve({ port, fetch: handler })` where `handler`
// is a `(req: Request) => Promise<Response>`. Node's `http.createServer` speaks
// `IncomingMessage` / `ServerResponse` instead. These two helpers translate at
// the edges — the route handler in `server.ts` is reused **unchanged**;
// OPTIONS / 405 / CORS all come from that handler, not from here.

import type { IncomingMessage, ServerResponse } from "node:http";

/** Build a Web `Request` from a Node `IncomingMessage`. */
export async function nodeToWebRequest(
  req: IncomingMessage,
  baseUrl: string,
): Promise<Request> {
  const url = new URL(req.url ?? "/", baseUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = (req.method ?? "GET").toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
    // Copy the buffered bytes into a fresh ArrayBuffer — ArrayBuffer is the
    // common denominator across the DOM `BodyInit` and undici `BodyInit` types
    // (the tsconfig pins `lib: ["ES2022","DOM"]`, which excludes `Buffer`).
    const buf = Buffer.concat(chunks);
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    body = ab;
  }

  return new Request(url, {
    method,
    headers,
    body,
  });
}

/** Pipe a Web `Response` out through a Node `ServerResponse`. */
export async function writeWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  // Collect headers — the DOM `Headers` here only exposes `forEach` without
  // `lib: ["DOM.Iterable"]`, so we don't lean on `.entries()`.
  const headerObj: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  res.writeHead(response.status, headerObj);
  res.end(Buffer.from(await response.arrayBuffer()));
}
