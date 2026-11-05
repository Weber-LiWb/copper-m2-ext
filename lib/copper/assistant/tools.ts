// Module 2: the tools Ask Copper can use (four from the module, plus
// estimate_delivery from the extension). Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

export type EstimateDeliveryInput = {
  product: ProductId;
  color: string;
  quantity: number;
};

export type DeliveryEstimate =
  | {
      status: "ok";
      product: string;
      color: string;
      quantity: number;
      stock: Stock;
      reason: "in_stock" | "waiting_for_restock";
      restockDate: string | null;
      shipsOn: string;
      arrivesEarliest: string;
      arrivesLatest: string;
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | {
      status: "restock_unknown";
      product: string;
      color: string;
      message: string;
    }
  | { status: "unavailable"; message: string };

const PRODUCT_IDS = ["copper-home", "copper-notes"] as const;

const roundCents = (amount: number) => Math.round(amount * 100) / 100;

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(z.enum(PRODUCT_IDS)).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = input.products.map((id) => {
    const product = catalog.find((p) => p.id === id)!;
    return { item: product.name, usd: roundCents(product.priceUsd) };
  });

  // Copper Plus covers the whole household, so it's one line however many
  // devices there are. The free plan costs nothing, so it gets no line.
  const plan = getPlans().find((p) => p.id === input.plan)!;
  if (plan.id !== "free") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const years = input.years === 1 ? "1 year" : `${input.years} years`;
    lines.push({
      item: `${plan.name}, ${input.billing}, ${years}`,
      usd: roundCents(usd),
    });
  }

  return {
    lines,
    totalUsd: roundCents(lines.reduce((sum, line) => sum + line.usd, 0)),
  };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z.enum(PRODUCT_IDS),
    color: z.string().optional(),
  });

function stockOf(units: number): Stock {
  if (units === 0) return "backordered";
  return units < 10 ? "low_stock" : "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product)!;

  // A color the product doesn't come in is answered from the catalog alone,
  // even when stock can't be read.
  let colors = product.colors;
  if (input.color !== undefined) {
    const wanted = input.color.trim().toLowerCase();
    colors = product.colors.filter((c) => c.toLowerCase() === wanted);
    if (colors.length === 0) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again soon.",
    };
  }

  return {
    status: "ok",
    product: product.name,
    colors: colors.flatMap((color) => {
      const row = rows.find(
        (r) => r.product === product.name && r.color === color,
      );
      if (!row) return [];
      const stock = stockOf(row.units_in_stock);
      return [
        {
          color,
          stock,
          restockDate: stock === "backordered" ? row.next_shipment : null,
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Extension: estimate_delivery
// ---------------------------------------------------------------------------

/**
 * Shipping rule for the extension. The Product Bible doesn't say how long
 * shipping takes, so this is an assumption we chose: an order ships the next
 * business day after it can be filled, and the carrier takes 3 to 5 business
 * days. Weekends are skipped; holidays are not modelled.
 */
export const SHIPPING_RULE = {
  handlingBusinessDays: 1,
  transitBusinessDaysMin: 3,
  transitBusinessDaysMax: 5,
  timeZone: "America/Phoenix",
} as const;

export const estimateDeliveryInput: z.ZodType<EstimateDeliveryInput> = z.object(
  {
    product: z.enum(PRODUCT_IDS),
    color: z.string().min(1),
    quantity: z.number().int().min(1).max(5),
  },
);

/** Today's date (YYYY-MM-DD) in Arizona, where Copper State Labs ships from. */
export function todayInArizona(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHIPPING_RULE.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Moves a YYYY-MM-DD date forward by some business days (Mon to Fri). */
export function addBusinessDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** estimate_delivery: when an order would ship and arrive, from today's stock. */
export async function estimateDelivery(
  input: EstimateDeliveryInput,
  today: string = todayInArizona(),
): Promise<DeliveryEstimate> {
  const product = getProducts().find((p) => p.id === input.product)!;
  const wanted = input.color.trim().toLowerCase();
  const color = product.colors.find((c) => c.toLowerCase() === wanted);
  if (!color) {
    return {
      status: "not_a_color",
      product: product.name,
      color: input.color,
      colors: product.colors,
    };
  }

  const rows = await readInventory();
  const row = rows?.find(
    (r) => r.product === product.name && r.color === color,
  );
  if (!rows || !row) {
    return {
      status: "unavailable",
      message:
        "Stock can't be checked right now, so delivery can't be estimated. Please try again soon.",
    };
  }

  const stock = stockOf(row.units_in_stock);
  const enough = row.units_in_stock >= input.quantity;

  // Not enough on the shelf: the order waits for the next shipment. A
  // shipment date that has already passed means we don't know when it lands.
  if (!enough && row.next_shipment < today) {
    return {
      status: "restock_unknown",
      product: product.name,
      color,
      message:
        "There isn't enough in stock and the next restock date isn't known yet. The Copper Crew can help.",
    };
  }

  const readyOn = enough ? today : row.next_shipment;
  const shipsOn = addBusinessDays(readyOn, SHIPPING_RULE.handlingBusinessDays);
  return {
    status: "ok",
    product: product.name,
    color,
    quantity: input.quantity,
    stock,
    reason: enough ? "in_stock" : "waiting_for_restock",
    restockDate: enough ? null : row.next_shipment,
    shipsOn,
    arrivesEarliest: addBusinessDays(
      shipsOn,
      SHIPPING_RULE.transitBusinessDaysMin,
    ),
    arrivesLatest: addBusinessDays(
      shipsOn,
      SHIPPING_RULE.transitBusinessDaysMax,
    ),
  };
}

export const copperTools = {
  get_products: tool({
    description:
      "Lists every Copper product with its type, price and the colors it comes in; says nothing about stock.",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Looks up the current price of every Copper product and every plan, monthly and yearly.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Works out the total cost of up to 5 devices plus a plan over 1 to 5 years; always use it for totals instead of doing the math yourself.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Checks today's stock for a product, or for one color of it, and says when back-ordered colors restock.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
  estimate_delivery: tool({
    description:
      "Estimates when an order of 1 to 5 units of one product color would ship and arrive, using today's stock and restock dates; always use it for delivery dates instead of working them out yourself.",
    inputSchema: estimateDeliveryInput,
    execute: async (input) => estimateDelivery(input),
  }),
} satisfies ToolSet;
