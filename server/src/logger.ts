import pino from "pino";
import { config } from "./config.js";

/**
 * Structured Pino logger with redaction list for sensitive fields.
 * Redacts tokens, passwords, authorization headers, and PII.
 */
export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-step-up-password"]',
      "req.headers.cookie",
      "password",
      "token",
      "tokenHash",
      "passwordHash",
      "secret",
      "email",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    log(obj) {
      return obj;
    },
  },
});
