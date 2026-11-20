import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createContainer } from "../src/container.js";
import { FakeClock } from "../src/adapters/fakeClock.js";

describe("Sensitive Operation Protection (Section 9 Security & Privacy)", () => {
  let app: ReturnType<typeof createApp>;
  let clock: FakeClock;
  let ownerToken: string;

  beforeEach(async () => {
    clock = new FakeClock();
    const container = createContainer({ clock });
    app = createApp(container);

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "secowner@delhi.local",
        password: "OwnerSecPassword123!",
        displayName: "Security Owner",
        householdName: "Security Test Household",
        location: { name: "Delhi", lat: 28.6, lng: 77.2 },
      });

    ownerToken = reg.body.token;
  });

  it("rejects household deletion when confirmation header or body is missing", async () => {
    const res = await request(app)
      .delete("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ stepUpPassword: "OwnerSecPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("x-confirm-action");
  });

  it("rejects household deletion when step-up password is missing", async () => {
    const res = await request(app)
      .delete("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("Step-up password confirmation required");
  });

  it("rejects household deletion when step-up password is wrong", async () => {
    const res = await request(app)
      .delete("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "WrongPassword999!" });

    expect(res.status).toBe(401);
    expect(res.body.detail).toContain("Invalid step-up password");
  });

  it("accepts deletion with valid header confirmation and correct step-up password", async () => {
    const res = await request(app)
      .delete("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "OwnerSecPassword123!" });

    expect(res.status).toBe(204);

    // Further requests with old token fail because household and sessions are purged
    const followUp = await request(app)
      .get("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect([401, 403]).toContain(followUp.status);
  });

  it("rejects household data export without confirmation and step-up password", async () => {
    const noConfirm = await request(app)
      .post("/api/v1/household/export")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ stepUpPassword: "OwnerSecPassword123!" });
    expect(noConfirm.status).toBe(400);

    const noPassword = await request(app)
      .post("/api/v1/household/export")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({});
    expect(noPassword.status).toBe(400);

    const wrongPassword = await request(app)
      .post("/api/v1/household/export")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "WrongPassword999!" });
    expect(wrongPassword.status).toBe(401);
  });

  it("successfully exports full household data with valid step-up confirmation", async () => {
    const res = await request(app)
      .post("/api/v1/household/export")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "OwnerSecPassword123!" });

    expect(res.status).toBe(200);
    expect(res.body.household.name).toBe("Security Test Household");
    expect(res.body.exportedAt).toBeDefined();
    expect(Array.isArray(res.body.members)).toBe(true);
  });

  it("protects password change with confirmation header and invalidates old sessions", async () => {
    // 1. Missing confirmation
    const noConfirm = await request(app)
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        currentPassword: "OwnerSecPassword123!",
        newPassword: "BrandNewSecurePassword456!",
      });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.detail).toContain("x-confirm-action");

    // 2. Missing fields
    const missingFields = await request(app)
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ currentPassword: "OwnerSecPassword123!" });
    expect(missingFields.status).toBe(400);

    // 3. Wrong current password
    const wrongCurrent = await request(app)
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({
        currentPassword: "WrongCurrentPassword123!",
        newPassword: "BrandNewSecurePassword456!",
      });
    expect(wrongCurrent.status).toBe(401);

    // 4. Short new password
    const shortNew = await request(app)
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({
        currentPassword: "OwnerSecPassword123!",
        newPassword: "short",
      });
    expect(shortNew.status).toBe(400);

    // 5. Valid password change
    const validChange = await request(app)
      .post("/api/v1/auth/password")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({
        currentPassword: "OwnerSecPassword123!",
        newPassword: "BrandNewSecurePassword456!",
      });
    expect(validChange.status).toBe(204);

    // 6. Old session must be completely invalidated
    const oldSessionCheck = await request(app)
      .get("/api/v1/household")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(oldSessionCheck.status).toBe(401);

    // 7. Login with new password works
    const newLogin = await request(app).post("/api/v1/auth/login").send({
      email: "secowner@delhi.local",
      password: "BrandNewSecurePassword456!",
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.token).toBeDefined();
  });

  it("protects member revocation and invitation revocation with confirmation header", async () => {
    // Create an invitation
    const inviteRes = await request(app)
      .post("/api/v1/household/invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        scopes: ["VIEW_PLAN", "LOG_ACTIONS"],
        expiresInDays: 7,
        recipientEmail: "invitedmember@delhi.local",
      });
    expect(inviteRes.status).toBe(201);
    const inviteId = inviteRes.body.invitation.id;

    // 1. Revoking invitation without confirmation fails
    const noConfirmInvite = await request(app)
      .delete(`/api/v1/household/invitations/${inviteId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(noConfirmInvite.status).toBe(400);

    // 2. Revoking invitation with confirmation succeeds
    const confirmInvite = await request(app)
      .delete(`/api/v1/household/invitations/${inviteId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true");
    expect(confirmInvite.status).toBe(204);

    // Register a second member to test member revocation
    const regMember = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "familymember@delhi.local",
        password: "MemberPassword123!",
        displayName: "Family Member",
        householdName: "Second Household",
        location: { name: "Delhi", lat: 28.6, lng: 77.2 },
      });
    const memberId = regMember.body.user.id;

    // Create a new invitation and join it
    const newInvite = await request(app)
      .post("/api/v1/household/invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        scopes: ["VIEW_PLAN"],
        expiresInDays: 7,
      });
    await request(app)
      .post("/api/v1/household/invitations/join")
      .set("Authorization", `Bearer ${regMember.body.token}`)
      .send({ token: newInvite.body.token });

    // 3. Revoking member without confirmation fails
    const noConfirmMember = await request(app)
      .delete(`/api/v1/household/members/${memberId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(noConfirmMember.status).toBe(400);

    // 4. Revoking member with confirmation succeeds
    const confirmMember = await request(app)
      .delete(`/api/v1/household/members/${memberId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true");
    expect(confirmMember.status).toBe(204);
  });

  it("supports sensitive operations on /profile alias paths", async () => {
    // Test export on /profile/export
    const exportRes = await request(app)
      .post("/api/v1/household/profile/export")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "OwnerSecPassword123!" });
    expect(exportRes.status).toBe(200);

    // Test delete on /profile
    const delRes = await request(app)
      .delete("/api/v1/household/profile")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("x-confirm-action", "true")
      .send({ stepUpPassword: "OwnerSecPassword123!" });
    expect(delRes.status).toBe(204);
  });
});
