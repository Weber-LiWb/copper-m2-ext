// Extension: the chat panel draws an estimate_delivery tool card. This once
// crashed because the panel treated every "ok" result as a stock list.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Answer } from "@/components/copper/ask-copper-steps";
import type { Progress } from "@/lib/copper/assistant/progress";

const progressWith = (output: unknown): Progress => ({
  status: "done",
  reply: "",
  steps: [
    {
      type: "tool",
      id: "1",
      name: "estimate_delivery",
      state: "done",
      input: { product: "copper-notes", color: "Night Sky", quantity: 1 },
      output,
    },
  ],
});

describe("estimate_delivery tool card", () => {
  it("shows what Copper sent and the ship and arrival dates", () => {
    render(
      <Answer
        useTools
        progress={progressWith({
          status: "ok",
          product: "Copper Notes",
          color: "Night Sky",
          quantity: 1,
          stock: "backordered",
          reason: "waiting_for_restock",
          restockDate: "2026-11-14",
          shipsOn: "2026-11-16",
          arrivesEarliest: "2026-11-19",
          arrivesLatest: "2026-11-23",
        })}
      />,
    );
    const card = screen.getByTestId("tool-call");
    expect(card).toHaveTextContent("estimate_delivery()");
    expect(card).toHaveTextContent("Estimating delivery");
    expect(card).toHaveTextContent("Quantity1");
    expect(card).toHaveTextContent("Back-ordered");
    expect(card).toHaveTextContent("Waits for restockNov 14, 2026");
    expect(card).toHaveTextContent("ShipsNov 16, 2026");
    expect(card).toHaveTextContent("Nov 19, 2026 – Nov 23, 2026");
  });

  it("shows the message when the restock date is unknown", () => {
    render(
      <Answer
        useTools
        progress={progressWith({
          status: "restock_unknown",
          product: "Copper Notes",
          color: "Night Sky",
          message: "The next restock date isn't known yet.",
        })}
      />,
    );
    expect(screen.getByTestId("tool-call")).toHaveTextContent(
      "The next restock date isn't known yet.",
    );
  });
});
