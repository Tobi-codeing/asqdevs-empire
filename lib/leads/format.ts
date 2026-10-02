import { formatBudget, formatBudgetRange } from "@/lib/data/properties";
import type { Lead } from "@/lib/leads/types";

export function formatTimeline(value?: string): string {
  if (!value) return "";
  const normalized = value.trim();

  const map: Record<string, string> = {
    Immediately: "immediately",
    "1–3 months": "within 1–3 months",
    "3–6 months": "within 3–6 months",
    "6–12 months": "within 6–12 months",
    "12 months": "within 1 year",
    "Just exploring": "just exploring",
  };

  return map[normalized] ?? normalized;
}

export function formatLocation(value?: string): string {
  if (!value) return "";
  return value.replace(/gurgaon/gi, "Gurugram").trim();
}

export function formatBudgetDisplay(
  min?: number | null,
  max?: number | null,
  fallback?: number | null,
): string | undefined {
  if (min == null && max == null && fallback == null) return undefined;

  const lower = min ?? max ?? fallback;
  const upper = max ?? min ?? fallback;

  if (lower == null || upper == null)
    return lower == null ? undefined : `around ${formatBudget(lower)}`;
  if (lower === upper) return `around ${formatBudget(lower)}`;

  return `around ${formatBudgetRange(lower, upper)}`;
}

export function budgetSummaryText(lead: Lead): string | undefined {
  if (lead.budgetLabel) return `around ${lead.budgetLabel}`;
  return formatBudgetDisplay(lead.budgetMin, lead.budgetMax, lead.budget);
}

export function formatLeadSummary(lead: Lead): string {
  const pieces = [
    lead.bhk,
    lead.propertyType,
    formatLocation(lead.location),
    budgetSummaryText(lead),
    formatTimeline(lead.timeline),
  ].filter(Boolean);

  if (!pieces.length) return "your requirement";
  return pieces.join(" · ");
}
