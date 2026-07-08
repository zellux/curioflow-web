type GeneratedSummary = {
  overview: string;
  points: string[];
};

function repairInvalidJsonEscapes(text: string) {
  return text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

function parseSummaryJson(candidate: string) {
  try {
    return JSON.parse(candidate) as { overview?: unknown; points?: unknown };
  } catch (error) {
    const repaired = repairInvalidJsonEscapes(candidate);
    if (repaired === candidate) throw error;
    return JSON.parse(repaired) as { overview?: unknown; points?: unknown };
  }
}

export function parseSummaryResponse(text: string): GeneratedSummary {
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = parseSummaryJson(candidate);
  const overview = typeof parsed.overview === "string" ? parsed.overview.trim() : "";
  const points = Array.isArray(parsed.points)
    ? parsed.points.filter((point): point is string => typeof point === "string").map((point) => point.trim()).filter(Boolean)
    : [];

  if (!overview || points.length === 0) {
    throw new Error("LLM summary response was missing overview or points.");
  }

  return {
    overview,
    points: points.slice(0, 3)
  };
}
