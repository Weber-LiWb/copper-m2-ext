// @vitest-environment node
// Extension: the estimate_delivery tool. Stock comes from a fake inventory so
// the dates are predictable. 2026-11-05 is a Thursday.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryRow } from "@/lib/copper/inventory";

let rows: InventoryRow[] | null = [];
vi.mock("@/lib/copper/inventory", () => ({
  readInventory: async () => rows,
}));

const {
  addBusinessDays,
  copperTools,
  estimateDelivery,
  estimateDeliveryInput,
  todayInArizona,
} = await import("@/lib/copper/assistant/tools");
const { TOOL_LABELS } = await import("@/lib/copper/assistant/progress");

const THURSDAY = "2026-11-05";

beforeEach(() => {
  rows = [
    {
      sku: "CN-BRC",
      product: "Copper Notes",
      color: "Brushed Copper",
      units_in_stock: 310,
      next_shipment: "2026-11-13",
    },
    {
      sku: "CN-NSK",
      product: "Copper Notes",
      color: "Night Sky",
      units_in_stock: 0,
      next_shipment: "2026-11-14",
    },
    {
      sku: "CH-TEA",
      product: "Copper Home",
      color: "Patina Teal",
      units_in_stock: 3,
      next_shipment: "2026-11-06",
    },
  ];
});

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    expect(addBusinessDays(THURSDAY, 1)).toBe("2026-11-06"); // Fri
    expect(addBusinessDays("2026-11-06", 1)).toBe("2026-11-09"); // Fri → Mon
    expect(addBusinessDays("2026-11-14", 1)).toBe("2026-11-16"); // Sat → Mon
    expect(addBusinessDays(THURSDAY, 5)).toBe("2026-11-12");
  });
});

describe("todayInArizona", () => {
  it("uses Arizona time, not UTC", () => {
    // 3am UTC on Nov 6 is still 8pm Nov 5 in Phoenix.
    expect(todayInArizona(new Date("2026-11-06T03:00:00Z"))).toBe(THURSDAY);
  });
});

describe("estimate_delivery", () => {
  it("in stock: ships next business day, arrives 3 to 5 business days later", async () => {
    const result = await estimateDelivery(
      { product: "copper-notes", color: "brushed copper", quantity: 2 },
      THURSDAY,
    );
    expect(result).toEqual({
      status: "ok",
      product: "Copper Notes",
      color: "Brushed Copper",
      quantity: 2,
      stock: "in_stock",
      reason: "in_stock",
      restockDate: null,
      shipsOn: "2026-11-06",
      arrivesEarliest: "2026-11-11",
      arrivesLatest: "2026-11-13",
    });
  });

  it("back-ordered: waits for the restock, then ships", async () => {
    const result = await estimateDelivery(
      { product: "copper-notes", color: "Night Sky", quantity: 1 },
      THURSDAY,
    );
    expect(result).toMatchObject({
      status: "ok",
      stock: "backordered",
      reason: "waiting_for_restock",
      restockDate: "2026-11-14",
      shipsOn: "2026-11-16",
      arrivesEarliest: "2026-11-19",
      arrivesLatest: "2026-11-23",
    });
  });

  it("more units than are on the shelf: the order waits for the restock", async () => {
    const result = await estimateDelivery(
      { product: "copper-home", color: "Patina Teal", quantity: 4 },
      THURSDAY,
    );
    expect(result).toMatchObject({
      status: "ok",
      stock: "low_stock",
      reason: "waiting_for_restock",
      restockDate: "2026-11-06",
      shipsOn: "2026-11-09",
    });
  });

  it("a color the product doesn't come in gets the real color list", async () => {
    const result = await estimateDelivery(
      { product: "copper-notes", color: "Hot Pink", quantity: 1 },
      THURSDAY,
    );
    expect(result).toMatchObject({ status: "not_a_color", color: "Hot Pink" });
    if (result.status === "not_a_color") {
      expect(result.colors).toContain("Night Sky");
    }
  });

  it("says so instead of guessing when stock can't be read", async () => {
    rows = null;
    const result = await estimateDelivery(
      { product: "copper-notes", color: "Night Sky", quantity: 1 },
      THURSDAY,
    );
    expect(result.status).toBe("unavailable");
  });

  it("a restock date already in the past means the date is unknown", async () => {
    const result = await estimateDelivery(
      { product: "copper-notes", color: "Night Sky", quantity: 1 },
      "2026-11-20",
    );
    expect(result.status).toBe("restock_unknown");
  });

  it("the contract rejects bad quantities and products", () => {
    const ok = { product: "copper-notes", color: "Night Sky", quantity: 1 };
    expect(estimateDeliveryInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, quantity: 6 },
      { ...ok, quantity: 0 },
      { ...ok, quantity: 1.5 },
      { ...ok, product: "copper-watch" },
      { ...ok, color: "" },
    ]) {
      expect(estimateDeliveryInput.safeParse(bad).success).toBe(false);
    }
  });

  it("is on the tool menu with a description and a panel label", () => {
    expect(copperTools.estimate_delivery.description).toMatch(/deliver/i);
    expect(TOOL_LABELS.estimate_delivery).toBe("Estimating delivery");
  });
});
