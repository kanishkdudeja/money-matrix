export function statusTone(status: string): "neutral" | "positive" | "warning" | "danger" {
  if (["posted", "completed", "reviewed", "ready", "enabled"].includes(status)) return "positive";
  if (["processing", "uploaded", "pending", "suggested", "in_progress", "reopened"].includes(status)) return "warning";
  if (["failed", "invalid"].includes(status)) return "danger";
  return "neutral";
}
