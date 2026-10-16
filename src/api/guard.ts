import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

// Staff endpoints are gated by one shared access code per deployment
// (RAKTSETU_ACCESS_CODE), sent as the x-access-code header. Unset = open,
// which is only meant for local development.
export const requireAccessCode: RequestHandler = (req, res, next) => {
  const expected = process.env.RAKTSETU_ACCESS_CODE;
  if (!expected) return next();
  const given = Buffer.from(String(req.get("x-access-code") ?? ""));
  const want = Buffer.from(expected);
  if (given.length === want.length && timingSafeEqual(given, want)) return next();
  res.status(401).json({ error: "access_code_required" });
};

// Fixed-window limiter per IP, kept in process memory. Good enough for one
// instance; a multi-instance deployment needs a shared store (Redis) instead.
export function rateLimit(maxPerMinute: number): RequestHandler {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(key, { count: 1, windowStart: now });
      if (hits.size > 10_000) hits.clear();
      return next();
    }
    if (++entry.count > maxPerMinute) return res.status(429).json({ error: "rate_limited" });
    next();
  };
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  next();
};
