import { describe, it, expect, beforeEach } from "vitest";
import { FakeClock } from "../src/adapters/fakeClock.js";
import { MemoryCommunityRepository } from "../src/repositories/memory/memoryCommunityRepo.js";
import { MemoryAuditRepository } from "../src/repositories/memory/memoryAuditRepo.js";
import { MemoryOutboxRepository } from "../src/repositories/memory/memoryOutboxRepo.js";
import { CommunityService } from "../src/services/community.service.js";

describe("CommunityService (FR-14, k-Anonymity, Advisories)", () => {
  let clock: FakeClock;
  let communityRepo: MemoryCommunityRepository;
  let auditRepo: MemoryAuditRepository;
  let outboxRepo: MemoryOutboxRepository;
  let communityService: CommunityService;

  beforeEach(() => {
    clock = new FakeClock();
    communityRepo = new MemoryCommunityRepository();
    auditRepo = new MemoryAuditRepository();
    outboxRepo = new MemoryOutboxRepository(clock);
    communityService = new CommunityService(communityRepo, auditRepo, outboxRepo, clock, 5); // k=5
  });

  it("enforces k-anonymity (k=5): hides metrics when contributors < 5", async () => {
    const comm = await communityService.createCommunity(
      "Mayur Vihar RWA",
      "RWA group",
      "user-admin",
      "hh-admin",
    );

    // Only 1 household contributing
    let stats = await communityService.getAggregates(comm.id);
    expect(stats.kAnonymityMet).toBe(false);
    expect(stats.totalCo2eSavedKg).toBeUndefined();
    expect(stats.totalPm25SavedG).toBeUndefined();

    // Add 3 more households -> total 4 (still < 5)
    for (let i = 1; i <= 3; i++) {
      await communityService.joinCommunity(comm.joinCode, `hh-${i}`, `user-${i}`);
    }
    stats = await communityService.getAggregates(comm.id);
    expect(stats.kAnonymityMet).toBe(false);

    // Add 5th household -> total 5 (k=5 met!)
    await communityService.joinCommunity(comm.joinCode, "hh-5", "user-5");
    stats = await communityService.getAggregates(comm.id);
    expect(stats.kAnonymityMet).toBe(true);
    expect(stats.totalCo2eSavedKg).toBeGreaterThan(0);
    expect(stats.totalPm25SavedG).toBeGreaterThan(0);
    expect(stats.averageBreatheScore).toBeDefined();
  });

  it("immediately updates aggregates when a household leaves", async () => {
    const comm = await communityService.createCommunity("RWA", "Desc", "admin", "hh-admin");
    for (let i = 1; i <= 4; i++) {
      await communityService.joinCommunity(comm.joinCode, `hh-${i}`, `user-${i}`);
    }

    // Now 5 members: k-anonymity is met
    expect((await communityService.getAggregates(comm.id)).kAnonymityMet).toBe(true);

    // Household leaves -> drops to 4
    await communityService.leaveCommunity(comm.id, "hh-4", "user-4");
    const statsAfter = await communityService.getAggregates(comm.id);
    expect(statsAfter.kAnonymityMet).toBe(false);
  });

  it("allows drafting advisory and queues outbox items upon admin approval", async () => {
    const comm = await communityService.createCommunity("RWA", "Desc", "admin", "hh-admin");
    await communityService.joinCommunity(comm.joinCode, "hh-2", "user-2");

    const draft = await communityService.draftAdvisory(
      comm.id,
      {
        title: "Smog Advisory: Avoid Leaf Burning",
        content: "Please do not burn leaves or garden waste this week due to severe inversion.",
      },
      "admin",
    );

    expect(draft.status).toBe("DRAFT");

    const approved = await communityService.approveAdvisory(comm.id, draft.id, "admin");
    expect(approved.status).toBe("APPROVED");

    // Outbox should contain delivery items for community households
    const outboxItems = await outboxRepo.findDueItems(clock.now(), 10);
    expect(outboxItems.length).toBe(2);
    expect(outboxItems[0]?.subject).toContain("Smog Advisory");

    // List advisories
    const advisories = await communityService.listAdvisories(comm.id);
    expect(advisories.length).toBe(1);
    expect(advisories[0]?.status).toBe("APPROVED");

    // Approving non-existent advisory throws NotFoundError
    await expect(
      communityService.approveAdvisory(comm.id, "non-existent-advisory", "admin"),
    ).rejects.toThrow("Advisory not found");
  });

  it("handles joinCommunity with invalid code and pledge management", async () => {
    // Invalid code throws NotFoundError
    await expect(communityService.joinCommunity("INVALID-CODE", "hh-x", "user-x")).rejects.toThrow(
      "Community not found with provided join code",
    );

    const comm = await communityService.createCommunity(
      "Pledge RWA",
      "Pledge Society",
      "admin",
      "hh-admin",
    );

    // Create a pledge
    const pledge = await communityService.createPledge(
      comm.id,
      {
        title: "No Biomass Burning",
        description: "Zero garden waste burning for the winter season",
        targetParticipants: 20,
        targetCo2eKg: 500,
        deadline: "2026-12-31",
      },
      "admin",
    );
    expect(pledge.title).toBe("No Biomass Burning");
    expect(pledge.targetParticipants).toBe(20);

    // List pledges without user
    const listNoUser = await communityService.listPledges(comm.id);
    expect(listNoUser.length).toBe(1);

    // Participate in pledge
    await communityService.participatePledge(pledge.id, "user-participant");

    // List pledges with user
    const listWithUser = await communityService.listPledges(comm.id, "user-participant");
    expect(listWithUser.length).toBe(1);
    expect(listWithUser[0]?.hasUserPledged).toBe(true);
  });
});
