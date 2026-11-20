import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

describe("Request ID, Cloud Trace, and OpenAPI Docs Endpoint", () => {
  const app = createApp();

  it("generates correlation ID and request ID if not provided", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-correlation-id"]).toBeDefined();
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.headers["x-correlation-id"]).toBe(res.headers["x-request-id"]);
  });

  it("preserves incoming x-request-id or x-correlation-id header", async () => {
    const customId = "trace-custom-correlation-12345";
    const res = await request(app).get("/health").set("x-correlation-id", customId);
    expect(res.headers["x-correlation-id"]).toBe(customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });

  it("propagates GCP Cloud Trace header (logging.googleapis.com/trace)", async () => {
    const traceHeader = "105445aa7843bc8bf206b12000100000/1;o=1";
    const res = await request(app).get("/health").set("x-cloud-trace-context", traceHeader);
    expect(res.headers["x-cloud-trace-context"]).toBe(traceHeader);
  });

  it("serves OpenAPI 3.0 specification at /api/docs and /api/docs/openapi.json", async () => {
    const res1 = await request(app).get("/api/docs");
    expect(res1.status).toBe(200);
    expect(res1.headers["content-type"]).toContain("application/json");
    expect(res1.body.openapi).toMatch(/^3\.0\./);
    expect(res1.body.info.title).toBeDefined();

    const res2 = await request(app).get("/api/docs/openapi.json");
    expect(res2.status).toBe(200);
    expect(res2.headers["content-type"]).toContain("application/json");
    expect(res2.body.openapi).toMatch(/^3\.0\./);
  });
});
