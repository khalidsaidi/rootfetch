import path from "node:path";
import { readFile } from "node:fs/promises";

function sanitizeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("relativePath must be a non-empty string.");
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid relative path: ${relativePath}`);
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  return segments.join("/");
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("baseUrl must be a non-empty string.");
  }
  return baseUrl.replace(/\/+$/, "");
}

export function createHttpTransport({ baseUrl, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required.");
  }

  const artifactsRoot = `${normalizeBaseUrl(baseUrl)}/rootfetch/artifacts`;

  return {
    async getBytes(relativePath) {
      const safePath = sanitizeRelativePath(relativePath);
      const response = await fetchImpl(`${artifactsRoot}/${safePath}`, {
        method: "GET"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${safePath}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

export function createFsTransport({ rootDir }) {
  if (typeof rootDir !== "string" || rootDir.trim() === "") {
    throw new Error("rootDir must be a non-empty string.");
  }

  const root = path.resolve(rootDir);

  return {
    async getBytes(relativePath) {
      const safePath = sanitizeRelativePath(relativePath);
      const target = path.resolve(root, safePath);
      const rel = path.relative(root, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path escapes rootDir: ${relativePath}`);
      }
      return new Uint8Array(await readFile(target));
    }
  };
}

