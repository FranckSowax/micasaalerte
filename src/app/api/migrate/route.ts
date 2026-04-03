import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();

  // Test if contributors table exists by trying to select from it
  const { error: testError } = await serviceClient
    .from("contributors")
    .select("id")
    .limit(1);

  if (testError && testError.message.includes("does not exist")) {
    return NextResponse.json({
      message: "Table 'contributors' does not exist. Run this SQL in Supabase Dashboard > SQL Editor:",
      sql: `CREATE TABLE IF NOT EXISTS contributors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    group_id TEXT NOT NULL,
    group_name TEXT,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0,
    annonces_created INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, group_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_contributors_user_id ON contributors(user_id);
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own contributors" ON contributors FOR ALL USING (auth.uid() = user_id);`,
    });
  }

  return NextResponse.json({ message: "Table 'contributors' already exists", ok: true });
}
