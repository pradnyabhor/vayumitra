import { describe, it, expect, beforeEach } from "vitest";
import { FakeClock } from "../src/adapters/fakeClock.js";
import { MemoryHouseholdRepository } from "../src/repositories/memory/memoryHouseholdRepo.js";
import { MemoryAuditRepository } from "../src/repositories/memory/memoryAuditRepo.js";
import { AuthService } from "../src/services/auth.service.js";
import {
  AuthenticationError,
  AccountLockedError,
  ConflictError,
  ValidationError,
} from "../src/services/errors.js";

describe("AuthService (FR-1, FR-13, Pillar 3 Security)", () => {
  let clock: FakeClock;
  let householdRepo: MemoryHouseholdRepository;
  let auditRepo: MemoryAuditRepository;
  let authService: AuthService;

  beforeEach(() => {
    clock = new FakeClock();
    householdRepo = new MemoryHouseholdRepository(clock);
    auditRepo = new MemoryAuditRepository();
    authService = new AuthService(householdRepo, auditRepo, clock);
  });

  it("registers a new user and creates household with full OWNER scopes", async () => {
    const res = await authService.register({
      email: "riya@delhi.local",
      password: "StrongPassword123!",
      displayName: "Riya",
      householdName: "Riya's Home",
      location: { name: "Delhi-NCR", lat: 28.6139, lng: 77.209 },
    });

    expect(res.user.email).toBe("riya@delhi.local");
    expect(res.household.role).toBe("OWNER");
    expect(res.household.scopes).toContain("READ");
    expect(res.household.scopes).toContain("DELETE");
    expect(res.token).toBeDefined();

    // Verify session validation
    const session = await authService.validateSession(res.token);
    expect(session.user.id).toBe(res.user.id);
  });

  it("rejects weak or common passwords", async () => {
    await expect(
      authService.register({
        email: "weak@test.com",
        password: "short",
        displayName: "Short",
        householdName: "Short Home",
        location: { name: "Delhi", lat: 28, lng: 77 },
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      authService.register({
        email: "common@test.com",
        password: "password123",
        displayName: "Common",
        householdName: "Common Home",
        location: { name: "Delhi", lat: 28, lng: 77 },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects duplicate registration with ConflictError", async () => {
    await authService.register({
      email: "dup@delhi.local",
      password: "StrongPassword123!",
      displayName: "Dup",
      householdName: "Dup Home",
      location: { name: "Delhi", lat: 28, lng: 77 },
    });

    await expect(
      authService.register({
        email: "dup@delhi.local",
        password: "AnotherPassword123!",
        displayName: "Dup2",
        householdName: "Dup Home 2",
        location: { name: "Delhi", lat: 28, lng: 77 },
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("locks account after 5 consecutive failed login attempts (HTTP 429)", async () => {
    await authService.register({
      email: "lockout@delhi.local",
      password: "CorrectPassword123!",
      displayName: "Lockout User",
      householdName: "Lockout Home",
      location: { name: "Delhi", lat: 28, lng: 77 },
    });

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      await expect(
        authService.login({ email: "lockout@delhi.local", password: "WrongPassword" }),
      ).rejects.toThrow(AuthenticationError);
    }

    // 5th failed attempt triggers lockout
    await expect(
      authService.login({ email: "lockout@delhi.local", password: "WrongPassword" }),
    ).rejects.toThrow(AccountLockedError);

    // Subsequent attempt even with correct password is still locked
    await expect(
      authService.login({ email: "lockout@delhi.local", password: "CorrectPassword123!" }),
    ).rejects.toThrow(AccountLockedError);

    // Fast-forward clock by 16 minutes
    clock.advanceMinutes(16);

    // Now login with correct password succeeds
    const successRes = await authService.login({
      email: "lockout@delhi.local",
      password: "CorrectPassword123!",
    });
    expect(successRes.token).toBeDefined();
  });

  it("invalidates session on logout", async () => {
    const reg = await authService.register({
      email: "logout@delhi.local",
      password: "CorrectPassword123!",
      displayName: "Logout User",
      householdName: "Logout Home",
      location: { name: "Delhi", lat: 28, lng: 77 },
    });

    await authService.logout(reg.token);
    await expect(authService.validateSession(reg.token)).rejects.toThrow(AuthenticationError);
  });

  it("handles revoked membership and missing household in session validation", async () => {
    const reg = await authService.register({
      email: "validatefail@delhi.local",
      password: "CorrectPassword123!",
      displayName: "Validate Fail User",
      householdName: "Validate Fail Home",
      location: { name: "Delhi", lat: 28, lng: 77 },
    });

    // Create a second user with REVOKED membership to test membership revocation handling
    const secondUser = await householdRepo.createUser({
      id: "revoked-user-id",
      email: "revoked@delhi.local",
      passwordHash: "hash",
      displayName: "Revoked Member",
    });
    await householdRepo.createMembership({
      householdId: reg.household.id,
      userId: secondUser.id,
      role: "MEMBER",
      scopes: ["READ"],
      status: "REVOKED",
    });
    const revokedToken = "revoked-member-token";
    const tokenHash = (authService as unknown as { hashToken: (t: string) => string }).hashToken(
      revokedToken,
    );
    await householdRepo.createSession({
      tokenHash,
      userId: secondUser.id,
      householdId: reg.household.id,
      expiresAt: new Date(clock.now().getTime() + 100000),
    });

    await expect(authService.validateSession(revokedToken)).rejects.toThrow(
      "Membership has been revoked or is inactive",
    );

    // Create session for non-existent household
    const fakeToken = "fake-token-missing-hh";
    const fakeHash = (authService as unknown as { hashToken: (t: string) => string }).hashToken(
      fakeToken,
    );
    await householdRepo.createSession({
      tokenHash: fakeHash,
      userId: reg.user.id,
      householdId: "missing-household-id",
      expiresAt: new Date(clock.now().getTime() + 1000000),
    });
    // Create active membership for missing household
    await householdRepo.createMembership({
      householdId: "missing-household-id",
      userId: reg.user.id,
      role: "OWNER",
      scopes: ["READ"],
      status: "ACTIVE",
    });

    await expect(authService.validateSession(fakeToken)).rejects.toThrow("Household not found");
  });

  it("handles password change with verification, validation, and session invalidation", async () => {
    const reg = await authService.register({
      email: "pwdchange@delhi.local",
      password: "OriginalPassword123!",
      displayName: "Password Change User",
      householdName: "Password Change Home",
      location: { name: "Delhi", lat: 28, lng: 77 },
    });

    // 1. Non-existent user
    await expect(
      authService.changePassword("non-existent-user", "OriginalPassword123!", "NewPassword123!"),
    ).rejects.toThrow("User not found");

    // 2. Incorrect current password
    await expect(
      authService.changePassword(reg.user.id, "WrongOriginalPassword!", "NewPassword123!"),
    ).rejects.toThrow("Current password is incorrect");

    // 3. Short new password
    await expect(
      authService.changePassword(reg.user.id, "OriginalPassword123!", "short"),
    ).rejects.toThrow("New password must be at least 8 characters long");

    // 4. Valid password change
    await authService.changePassword(
      reg.user.id,
      "OriginalPassword123!",
      "BrandNewPassword456!",
      "corr-pwd",
    );

    // Old token should be invalidated
    await expect(authService.validateSession(reg.token)).rejects.toThrow(AuthenticationError);
  });

  it("handles non-existent user on login and session validation", async () => {
    // 1. Login with non-existent user
    await expect(
      authService.login({ email: "ghost@delhi.local", password: "Password123!" }),
    ).rejects.toThrow(AuthenticationError);

    // 2. Validate session where user record was deleted
    const ghostToken = "ghost-token-no-user";
    const ghostHash = (authService as unknown as { hashToken: (t: string) => string }).hashToken(
      ghostToken,
    );
    await householdRepo.createSession({
      tokenHash: ghostHash,
      userId: "deleted-user-id",
      householdId: "some-household",
      expiresAt: new Date(clock.now().getTime() + 100000),
    });
    await expect(authService.validateSession(ghostToken)).rejects.toThrow("User not found");
  });
});
