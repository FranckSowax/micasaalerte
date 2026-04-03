import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  const supabase = createServiceClient();

  let query = supabase
    .from("annonces")
    .select("quartier")
    .eq("ai_is_real_estate", true)
    .not("quartier", "is", null);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data } = await query.limit(500);

  // Count and deduplicate quartiers (normalize)
  const counts = new Map<string, number>();
  for (const row of data || []) {
    const q = ((row as Record<string, unknown>).quartier as string || "").trim();
    if (!q || q.length < 2) continue;
    // Normalize: capitalize first letter
    const normalized = q.charAt(0).toUpperCase() + q.slice(1);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  // Sort by frequency descending
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json(sorted);
}
