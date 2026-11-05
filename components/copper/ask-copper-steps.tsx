"use client";

// The stations Ask Copper draws for one answer: the tools on offer, Copper's
// thinking, each tool call (what it sent, what came back) and the reply. Types
// only are imported from tools.ts: it reads the stock list, so a client
// component can't import its code.
import {
  BrainIcon,
  ListChecksIcon,
  MessageCircleIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Streamdown } from "streamdown";
import { Spinner } from "@/components/ui/spinner";
import { formatUsd, getProducts } from "@/lib/copper/catalog";
import {
  type Progress,
  type ToolStep,
  TOOL_LABELS,
} from "@/lib/copper/assistant/progress";
import type {
  Availability,
  CostBreakdown,
  DeliveryEstimate,
  Prices,
  ProductList,
} from "@/lib/copper/assistant/tools";
import { cn } from "@/lib/utils";

const TOOL_NAMES = Object.keys(TOOL_LABELS);

/** A station on the rail: a round node with an icon, and its content. */
function Station({
  icon,
  nodeClass,
  label,
  children,
}: {
  icon: ReactNode;
  nodeClass: string;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative pb-4 pl-9 last:pb-0">
      <span
        className={cn(
          "ring-secondary absolute top-0 left-0 flex size-6 items-center justify-center rounded-full text-white ring-4 [&_svg]:size-3.5",
          nodeClass,
        )}
      >
        {icon}
      </span>
      {label && (
        <p className="text-muted-foreground pt-1 text-[11px] font-semibold tracking-widest uppercase">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function ToolsStation({
  used,
  useTools,
}: {
  used: Set<string>;
  useTools: boolean;
}) {
  return (
    <Station
      icon={<ListChecksIcon />}
      nodeClass={useTools ? "bg-chart-5" : "bg-chart-3"}
      label={useTools ? "Tools Copper can use" : "Tools given to Copper: none"}
    >
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {TOOL_NAMES.map((name) => (
          <span
            key={name}
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-xs",
              !useTools && "text-muted-foreground bg-muted line-through",
              useTools && used.has(name) && "bg-accent font-bold text-white",
              useTools && !used.has(name) && "bg-muted text-muted-foreground",
            )}
          >
            {name}
          </span>
        ))}
      </div>
      {!useTools && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Copper has to answer from memory alone.
        </p>
      )}
    </Station>
  );
}

const productName = (id: unknown) =>
  getProducts().find((p) => p.id === id)?.name ?? String(id);

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-3 text-xs">
      <dt className="text-muted-foreground w-16 shrink-0">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** What Copper sent, as a labelled list: never raw JSON. */
function SentList({ step }: { step: ToolStep }) {
  if (step.name === "get_prices")
    return (
      <p className="text-xs">Nothing, it just asked for the price list.</p>
    );
  if (step.name === "get_products")
    return <p className="text-xs">Nothing, it just asked what Copper sells.</p>;
  if (step.input === undefined)
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Spinner className="size-3" /> filling in the details…
      </p>
    );

  const input = step.input as Record<string, unknown>;
  if (step.name === "calculate_cost") {
    const products = Array.isArray(input.products) ? input.products : [];
    return (
      <dl className="space-y-0.5">
        <Row
          label="Products"
          value={
            products.length ? products.map(productName).join(", ") : "None"
          }
        />
        <Row
          label="Plan"
          value={input.plan === "copper-plus" ? "Copper Plus" : "Free"}
        />
        <Row label="Billing" value={String(input.billing)} />
        <Row label="Years" value={String(input.years)} />
      </dl>
    );
  }
  return (
    <dl className="space-y-0.5">
      <Row label="Product" value={productName(input.product)} />
      <Row label="Color" value={String(input.color ?? "All colors")} />
      {step.name === "estimate_delivery" && (
        <Row label="Quantity" value={String(input.quantity ?? 1)} />
      )}
    </dl>
  );
}

const STOCK_PILLS = {
  in_stock: { text: "In stock", className: "bg-accent text-white" },
  low_stock: {
    text: "Low stock",
    className: "bg-chart-4 text-foreground",
  },
  backordered: { text: "Back-ordered", className: "bg-chart-3 text-white" },
} as const;

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** What came back, in the shape of each tool's answer. */
function ResultView({ step }: { step: ToolStep }) {
  if (step.state === "error")
    return <p className="text-xs">{String(step.output)}</p>;
  if (step.name === "calculate_cost") {
    const { lines, totalUsd } = step.output as CostBreakdown;
    return (
      <div className="space-y-1 text-xs">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span>{line.item}</span>
            <span className="tabular-nums">{formatUsd(line.usd)}</span>
          </div>
        ))}
        <div className="border-t pt-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">Total</span>
            <span className="text-primary text-lg font-bold tabular-nums">
              {formatUsd(totalUsd)}
            </span>
          </div>
        </div>
      </div>
    );
  }
  if (step.name === "get_products") {
    const { products } = step.output as ProductList;
    return (
      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id}>
            <p className="text-xs font-medium">
              {p.name} · {formatUsd(p.priceUsd)}
            </p>
            <p className="text-muted-foreground text-[11px]">{p.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {p.colors.map((color) => (
                <span
                  key={color}
                  className="bg-accent/15 text-accent-foreground rounded-full px-2 py-0.5 text-[11px]"
                >
                  {color}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "get_prices") {
    const { products, plans } = step.output as Prices;
    return (
      <div className="space-y-0.5 text-xs">
        {products.map((p) => (
          <div key={p.id} className="flex justify-between gap-3">
            <span>{p.name}</span>
            <span>{formatUsd(p.priceUsd)}</span>
          </div>
        ))}
        {plans
          .filter((plan) => plan.monthlyUsd > 0)
          .map((plan) => (
            <div key={plan.id} className="flex justify-between gap-3">
              <span>{plan.name}</span>
              <span>
                {formatUsd(plan.monthlyUsd)}/mo · {formatUsd(plan.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  }
  if (step.name === "estimate_delivery") {
    const delivery = step.output as DeliveryEstimate;
    if (delivery.status === "ok") {
      const pill = STOCK_PILLS[delivery.stock];
      return (
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span>
              {delivery.quantity} × {delivery.product}, {delivery.color}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px]",
                pill.className,
              )}
            >
              {pill.text}
            </span>
          </div>
          {delivery.restockDate && (
            <div className="flex justify-between gap-3">
              <span>Waits for restock</span>
              <span>{longDate(delivery.restockDate)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span>Ships</span>
            <span>{longDate(delivery.shipsOn)}</span>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <span>Arrives</span>
            <span>
              {longDate(delivery.arrivesEarliest)} –{" "}
              {longDate(delivery.arrivesLatest)}
            </span>
          </div>
        </div>
      );
    }
    if (delivery.status === "not_a_color")
      return (
        <p className="text-xs">
          {delivery.product} doesn&apos;t come in {delivery.color}. Its colors
          are {delivery.colors.join(", ")}.
        </p>
      );
    return <p className="text-xs">{delivery.message}</p>;
  }
  const result = step.output as Availability;
  if (result.status === "not_a_color")
    return (
      <p className="text-xs">
        {result.product} doesn&apos;t come in {result.color}. Its colors are{" "}
        {result.colors.join(", ")}.
      </p>
    );
  if (result.status === "unavailable")
    return <p className="text-xs">{result.message}</p>;
  return (
    <div className="space-y-1 text-xs">
      {result.colors.map((c) => {
        const pill = STOCK_PILLS[c.stock];
        return (
          <div
            key={c.color}
            className="flex items-center justify-between gap-3"
          >
            <span>{c.color}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px]",
                pill.className,
              )}
            >
              {c.restockDate
                ? `${pill.text} until ${longDate(c.restockDate)}`
                : pill.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ToolCard({ step, index }: { step: ToolStep; index: number }) {
  const running = step.state === "calling";
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card mt-1.5 overflow-hidden rounded-lg border text-sm"
    >
      <div className="bg-accent flex items-center gap-2 px-3 py-1.5 text-white">
        <span className="font-mono text-xs font-bold">{step.name}()</span>
        <span className="rounded bg-white/20 px-1.5 text-[10px]">
          tool {index}
        </span>
        <span className="ml-auto text-xs">{TOOL_LABELS[step.name]}</span>
      </div>
      <div className="space-y-1 p-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
          → What Copper sent
        </p>
        <SentList step={step} />
      </div>
      <div className="bg-accent/10 space-y-1 border-t p-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
          ← What came back
        </p>
        {running ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Spinner className="size-3" /> the app is running the code…
          </p>
        ) : (
          <ResultView step={step} />
        )}
      </div>
    </div>
  );
}

function WorkingLine({
  progress,
  useTools,
}: {
  progress: Progress;
  useTools: boolean;
}) {
  const text =
    progress.reply !== ""
      ? "Writing the answer…"
      : !useTools
        ? "Answering from memory…"
        : progress.steps.length > 0
          ? "Deciding what to do next…"
          : "Reading your question…";
  return (
    <Station
      icon={
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1 animate-bounce rounded-full bg-white"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
      }
      nodeClass={cn("animate-pulse", useTools ? "bg-primary" : "bg-chart-3")}
    >
      <p className="text-muted-foreground pt-0.5 text-xs">{text}</p>
    </Station>
  );
}

/** One answer: the rail of stations, then Copper's reply. */
export function Answer({
  progress,
  useTools,
}: {
  progress: Progress;
  useTools: boolean;
}) {
  const working = progress.status === "working";
  const used = new Set(
    progress.steps.filter((s) => s.type === "tool").map((s) => s.name),
  );
  let toolNumber = 0;
  return (
    <div className="space-y-3">
      <div className="relative">
        <div
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5 rounded-full",
            useTools
              ? "from-primary via-accent to-accent bg-linear-to-b"
              : "bg-chart-3",
          )}
        />
        <ToolsStation used={used} useTools={useTools} />
        {progress.steps.map((step, i) =>
          step.type === "thinking" ? (
            <Station
              key={i}
              icon={<BrainIcon />}
              nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
              label="Copper is thinking"
            >
              <div
                data-testid="thinking"
                className="text-muted-foreground mt-1 border-l-2 pl-3 text-xs italic [&_p]:my-0"
              >
                <Streamdown>{step.text}</Streamdown>
              </div>
            </Station>
          ) : (
            <Station
              key={step.id}
              icon={<WrenchIcon />}
              nodeClass="bg-accent"
              label={
                step.state === "calling"
                  ? "Copper is calling a tool"
                  : "Copper called a tool"
              }
            >
              <ToolCard step={step} index={++toolNumber} />
            </Station>
          ),
        )}
        {working && <WorkingLine progress={progress} useTools={useTools} />}
      </div>

      {progress.reply !== "" && (
        <div
          className={cn(
            "bg-card ml-9 rounded-2xl rounded-tl-sm border p-3 text-sm shadow-xs",
          )}
        >
          <p className="text-primary mb-1 text-xs font-semibold">Copper</p>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 mb-2 rounded-md border p-2 text-xs">
              <p className="flex items-center gap-1 font-semibold">
                <TriangleAlertIcon className="size-3.5" />
                Answered without tools: may be made up
              </p>
              <p className="mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="whitespace-pre-wrap">
            {progress.reply}
            {working && (
              <span className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom" />
            )}
          </p>
        </div>
      )}
      {progress.status === "error" && progress.reply === "" && (
        <p className="ml-9 flex items-center gap-1 text-xs">
          <MessageCircleIcon className="size-3.5" /> Something went wrong.
        </p>
      )}
    </div>
  );
}
