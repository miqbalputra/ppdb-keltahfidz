import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const port = Number(process.env.UX_AUDIT_PORT || 8766);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (url.pathname === "/api/config") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      cutoffDate: "2027-07-01",
      eligibleBirthdate: "2021-01-01",
      minAgeYears: 6,
      minAgeMonths: 6,
      whatsappGroupUrl: "",
      turnstileSiteKey: "",
    }));
    return;
  }

  if (url.pathname === "/api/admin/me") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ authenticated: false, username: null, csrfToken: null }));
    return;
  }

  if (url.pathname === "/api/regions/provinces") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ items: [{ id: "32", name: "Jawa Barat" }] }));
    return;
  }

  const routeAliases = { "/": "/index.html", "/admin": "/admin.html", "/success": "/success.html" };
  const pathname = routeAliases[url.pathname] || decodeURIComponent(url.pathname);
  const filePath = resolve(publicDirectory, `.${pathname}`);
  if (!filePath.startsWith(publicDirectory + sep)) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UI audit fixture listening at http://127.0.0.1:${port}`);
});
