import { describe, it, expect, beforeEach } from "vitest";
import { FakeClock } from "../src/adapters/fakeClock.js";
import { ScenarioProvider } from "../src/adapters/scenarioProvider.js";
import { MemoryHouseholdRepository } from "../src/repositories/memory/memoryHouseholdRepo.js";
import { MemoryAuditRepository } from "../src/repositories/memory/memoryAuditRepo.js";
import { PlanService } from "../src/services/plan.service.js";
import { ForbiddenError } from "../src/services/errors.js";

describe("PlanService (FR-1, FR-3, FR-16 Calendar Export, Action Toggles)", () => {
  let clock: FakeClock;
  let householdRepo: MemoryHouseholdRepository;
  let auditRepo: MemoryAuditRepository;
  let airProvider: ScenarioProvider;
  let planService: PlanService;
  const householdId = "hh-plan-test";
  const ownerUserId = "user-owner-plan";
  const memberUserId = "user-member-plan";

  beforeEach(async () => {
    clock = new FakeClock();
    householdRepo = new MemoryHouseholdRepository(clock);
    auditRepo = new MemoryAuditRepository();
    airProvider = new ScenarioProvider(clock, "Severe");

    // Setup household
    await householdRepo.createHousehold(
      {
        id: householdId,
        name: "Plan Household",
        location: { name: "Delhi", lat: 28.6, lng: 77.2 },
        members: [
          {
            id: "m-child",
            name: "Child",
            ageGroup: "child",
            sensitiveFlags: {
              child: true,
              olderAdult: false,
              respiratoryCondition: true,
              pregnancy: false,
            },
            commuteMode: "walk",
            commuteDistanceKm: 2,
          },
        ],
        rooms: [],
        cookingFuel: "lpg",
        aiPersonalizationConsent: false,
        shareWithCommunityConsent: false,
        preferredLanguage: "en",
      },
      ownerUserId,
    );

    // Setup member with READ only (cannot log actions)
    await householdRepo.createMembership({
      householdId,
      userId: memberUserId,
      role: "MEMBER",
      scopes: ["READ"],
      status: "ACTIVE",
    });

    planService = new PlanService(householdRepo, auditRepo, airProvider, clock);
  });

  it("builds daily plan with priority top 3 cards and standard guidance", async () => {
    const plan = await planService.getTodayPlan(householdId, ownerUserId);
    expect(plan.cards.length).toBeGreaterThan(0);
    expect(plan.top3PriorityCardIds.length).toBeLessThanOrEqual(3);
    expect(plan.isAiEnhanced).toBe(false);
    expect(plan.aiBadge).toBe("Standard guidance");
  });

  it("allows authorized member to toggle action cards", async () => {
    const plan = await planService.getTodayPlan(householdId, ownerUserId);
    const firstCard = plan.cards[0]!;

    // Toggle card completed
    await planService.toggleAction(householdId, ownerUserId, firstCard.id, true, "corr-toggle-1");

    // Retrieve plan again - card should now be marked completed
    const updatedPlan = await planService.getTodayPlan(householdId, ownerUserId);
    const updatedCard = updatedPlan.cards.find((c) => c.id === firstCard.id);
    expect(updatedCard?.completed).toBe(true);

    // Audit log recorded
    const logs = await auditRepo.listByTenant(householdId);
    expect(logs.some((l) => l.action === "ACTION_TOGGLE")).toBe(true);

    // Toggle back to uncompleted
    await planService.toggleAction(householdId, ownerUserId, firstCard.id, false, "corr-toggle-2");
    const uncompletedPlan = await planService.getTodayPlan(householdId, ownerUserId);
    expect(uncompletedPlan.cards.find((c) => c.id === firstCard.id)?.completed).toBe(false);
  });

  it("denies getTodayPlan and toggleAction to unauthorized users", async () => {
    // Non-member cannot access plan
    await expect(planService.getTodayPlan(householdId, "unauthorized-user")).rejects.toThrow(
      ForbiddenError,
    );

    // Member without CREATE scope cannot toggle
    await expect(
      planService.toggleAction(householdId, memberUserId, "card-1", true),
    ).rejects.toThrow(ForbiddenError);
  });

  it("exports valid RFC 5545 iCalendar (.ics) string for today's plan", async () => {
    const icsContent = await planService.exportCalendarIcs(householdId, ownerUserId);
    expect(icsContent).toContain("BEGIN:VCALENDAR");
    expect(icsContent).toContain("VERSION:2.0");
    expect(icsContent).toContain("PRODID:-//VayuMitra//Air Quality Assistant//EN");
    expect(icsContent).toContain("BEGIN:VEVENT");
    expect(icsContent).toContain("SUMMARY:[VayuMitra]");
    expect(icsContent).toContain("END:VEVENT");
    expect(icsContent).toContain("END:VCALENDAR");
  });

  it("handles households with electric cooking fuel and purifiers", async () => {
    const electricHouseholdId = "hh-electric";
    await householdRepo.createHousehold(
      {
        id: electricHouseholdId,
        name: "Electric Cooking Household",
        location: { name: "Delhi", lat: 28.6, lng: 77.2 },
        members: [],
        rooms: [
          {
            id: "r1",
            name: "Living",
            volumeM3: 45,
            hasPurifier: true,
            purifierCadrM3h: 300,
            windowsHabit: "closed",
          },
        ],
        cookingFuel: "electric" as unknown as "lpg",
        aiPersonalizationConsent: false,
        shareWithCommunityConsent: false,
        preferredLanguage: "en",
      },
      ownerUserId,
    );

    const plan = await planService.getTodayPlan(electricHouseholdId, ownerUserId);
    expect(plan.cards.length).toBeGreaterThan(0);
  });
});
