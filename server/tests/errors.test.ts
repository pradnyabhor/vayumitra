import { describe, it, expect } from "vitest";
import {
  DomainError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitExceededError,
  AccountLockedError,
} from "../src/services/errors.js";

describe("Domain Errors (RFC 7807 problem details)", () => {
  it("creates DomainError with default and explicit parameters", () => {
    const errDefault = new DomainError("Default Error");
    expect(errDefault.status).toBe(400);
    expect(errDefault.statusCode).toBe(400);
    expect(errDefault.title).toBe("Default Error");
    expect(errDefault.detail).toBe("Default Error");

    const errExplicit = new DomainError("Custom Error", 418, "I am a teapot", { foo: "bar" });
    expect(errExplicit.status).toBe(418);
    expect(errExplicit.statusCode).toBe(418);
    expect(errExplicit.detail).toBe("I am a teapot");
    expect(errExplicit.details).toEqual({ foo: "bar" });
  });

  it("creates specific typed domain errors", () => {
    const authErr = new AuthenticationError();
    expect(authErr.status).toBe(401);
    expect(authErr.name).toBe("AuthenticationError");

    const forbiddenErr = new ForbiddenError();
    expect(forbiddenErr.status).toBe(403);

    const notFoundErr = new NotFoundError();
    expect(notFoundErr.status).toBe(404);

    const conflictErr = new ConflictError();
    expect(conflictErr.status).toBe(409);

    const validationErr = new ValidationError("Invalid field", [
      { name: "email", reason: "invalid email format" },
    ]);
    expect(validationErr.status).toBe(400);
    expect(validationErr.invalidParams).toEqual([
      { name: "email", reason: "invalid email format" },
    ]);

    const rateLimitErr = new RateLimitExceededError(60);
    expect(rateLimitErr.status).toBe(429);
    expect(rateLimitErr.retryAfterSeconds).toBe(60);

    const lockoutErr = new AccountLockedError("Account locked", 900);
    expect(lockoutErr.status).toBe(429);
    expect(lockoutErr.retryAfterSeconds).toBe(900);
  });
});
