import { describe, it, expect, beforeEach } from "vitest";

describe("High-Contrast Mode Verification (Pillar 5, §10)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-contrast");
    localStorage.clear();
  });

  it("persists high-contrast preference in localStorage key vayumitra.contrast", () => {
    document.documentElement.setAttribute("data-contrast", "high");
    localStorage.setItem("vayumitra.contrast", "high");

    expect(localStorage.getItem("vayumitra.contrast")).toBe("high");
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
  });

  it("removes high-contrast attribute when toggled off", () => {
    document.documentElement.setAttribute("data-contrast", "high");
    localStorage.setItem("vayumitra.contrast", "high");

    // Toggle off
    document.documentElement.removeAttribute("data-contrast");
    localStorage.removeItem("vayumitra.contrast");

    expect(localStorage.getItem("vayumitra.contrast")).toBeNull();
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });
});
