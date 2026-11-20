import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    crypto.randomUUID();

  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  res.setHeader("x-request-id", correlationId);

  const cloudTraceHeader = req.headers["x-cloud-trace-context"] as string | undefined;
  if (cloudTraceHeader) {
    const traceId = cloudTraceHeader.split("/")[0];
    req.traceId = traceId;
    res.setHeader("x-cloud-trace-context", cloudTraceHeader);
  }

  next();
}
