import { SeverityLevel } from "@prisma/client";

export function computeSeverity(depthCm: number): SeverityLevel {
  if (depthCm <= 30) return "low";
  if (depthCm <= 60) return "medium";
  if (depthCm <= 100) return "high";
  return "extreme";
}

/**
 * confidence_score = (confirmRatio * 0.5) + (reporterReputation * 0.3) + (clusterBonus * 0.2)
 * Max = 100
 */
export function computeConfidence(
  confirms: number,
  rejects: number,
  reporterReputation: number,
  nearbyActiveReports: number
): number {
  const totalVotes = confirms + rejects;
  const confirmRatio = totalVotes > 0 ? (confirms / totalVotes) * 100 : 50;

  const reputationScore = Math.min(reporterReputation / 10, 100);
  const clusterBonus = Math.min(nearbyActiveReports * 10, 100);

  const score = confirmRatio * 0.5 + reputationScore * 0.3 + clusterBonus * 0.2;
  return Math.round(Math.min(score, 100) * 10) / 10;
}
