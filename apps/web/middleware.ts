import { NextRequest, NextResponse } from "next/server";

function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="RootFetch MCP Admin"',
    },
  });
}

function unavailable(): NextResponse {
  return new NextResponse("Admin auth not configured", { status: 503 });
}

function decodeBasicAuth(headerValue: string): { user: string; pass: string } | null {
  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "basic") {
    return null;
  }

  try {
    const decoded = atob(parts[1] || "");
    const splitIdx = decoded.indexOf(":");
    if (splitIdx < 0) {
      return null;
    }
    return {
      user: decoded.slice(0, splitIdx),
      pass: decoded.slice(splitIdx + 1),
    };
  } catch {
    return null;
  }
}

function credentialsFromEnv(): { user: string; pass: string } | null {
  const user = (process.env.ADMIN_DASH_USER || process.env.ROOTFETCH_ADMIN_USER || "admin").trim();
  const pass = (process.env.ADMIN_DASH_PASS || process.env.ROOTFETCH_ADMIN_PASS || "").trim();
  if (!user || !pass) {
    return null;
  }
  return { user, pass };
}

export function middleware(request: NextRequest): NextResponse {
  const expected = credentialsFromEnv();
  if (!expected) {
    return unavailable();
  }

  const authHeader = request.headers.get("authorization") || "";
  const auth = decodeBasicAuth(authHeader);
  if (!auth) {
    return unauthorized();
  }

  if (auth.user !== expected.user || auth.pass !== expected.pass) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/mcp/usage",
    "/mcp/usage/:path*",
    "/admin/usage",
    "/admin/usage/:path*",
    "/admin/agent-events",
    "/admin/agent-events/:path*",
    "/api/mcp/stats",
    "/api/mcp/events",
  ],
};
