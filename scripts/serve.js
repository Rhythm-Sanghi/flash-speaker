import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};
http
  .createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const file = resolve(
        root,
        "." + pathname,
        pathname.endsWith("/") ? "index.html" : "",
      );
      if (!file.startsWith(resolve(root) + sep)) {
        response.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(data);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 8091), "127.0.0.1", () =>
    console.log(
      "Flash Speaker: http://127.0.0.1:" + (process.env.PORT || 8091),
    ),
  );
