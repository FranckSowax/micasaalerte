import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();
  const missing: string[] = [];
  const sqlStatements: string[] = [];

  // Check contributors
  const { error: e1 } = await serviceClient.from("contributors").select("id").limit(1);
  if (e1?.message?.includes("does not exist")) {
    missing.push("contributors");
    sqlStatements.push(`CREATE TABLE IF NOT EXISTS contributors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    group_id TEXT NOT NULL, group_name TEXT,
    member_id TEXT NOT NULL, member_name TEXT NOT NULL, member_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true, last_scraped_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0, annonces_created INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, group_id, member_id)
);
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own contributors" ON contributors FOR ALL USING (auth.uid() = user_id);`);
  }

  // Check tiktok_accounts
  const { error: e2 } = await serviceClient.from("tiktok_accounts").select("id").limit(1);
  if (e2?.message?.includes("does not exist")) {
    missing.push("tiktok_accounts");
    sqlStatements.push(`CREATE TABLE IF NOT EXISTS tiktok_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    tiktok_handle TEXT NOT NULL, tiktok_url TEXT NOT NULL, sec_uid TEXT,
    is_active BOOLEAN DEFAULT true, last_scraped_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0, annonces_created INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, tiktok_handle)
);
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own tiktok accounts" ON tiktok_accounts FOR ALL USING (auth.uid() = user_id);

-- Also update raw_posts source_type constraint
ALTER TABLE raw_posts DROP CONSTRAINT IF EXISTS raw_posts_source_type_check;
ALTER TABLE raw_posts ADD CONSTRAINT raw_posts_source_type_check CHECK (source_type IN ('group', 'profile', 'tiktok'));`);
  }

  if (missing.length === 0) {
    return NextResponse.json({ message: "All tables exist", ok: true });
  }

  return NextResponse.json({
    message: `Missing tables: ${missing.join(", ")}. Run this SQL in Supabase Dashboard > SQL Editor:`,
    sql: sqlStatements.join("\n\n"),
  });
}
