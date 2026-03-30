-- ============================================================
-- SCHEMA SUPABASE — ImmoTracker SaaS
-- Multi-tenant avec RLS
-- ============================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
    whatsapp_phone TEXT,
    -- Clés API stockées par utilisateur
    rapidapi_key TEXT,
    kimi_api_key TEXT,
    whatsapp_phone_number_id TEXT,
    whatsapp_access_token TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger pour créer un profile automatiquement à l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. GROUPES FACEBOOK
-- ============================================================
CREATE TABLE facebook_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    group_id TEXT NOT NULL,
    group_url TEXT NOT NULL,
    group_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, group_id)
);

-- ============================================================
-- 3. ANNONCES IMMOBILIÈRES
-- ============================================================
CREATE TABLE annonces (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

    -- Identifiants Facebook
    fb_post_id TEXT NOT NULL,
    fb_post_url TEXT,
    fb_group_id UUID REFERENCES facebook_groups(id) ON DELETE SET NULL,
    fb_author_name TEXT,
    fb_author_id TEXT,
    fb_posted_at TIMESTAMPTZ,

    -- Contenu brut
    raw_text TEXT NOT NULL,
    raw_images TEXT[] DEFAULT '{}',

    -- Données extraites par IA
    type_bien TEXT,
    type_offre TEXT,
    prix NUMERIC,
    devise TEXT DEFAULT 'FCFA',
    nb_pieces INTEGER,
    nb_chambres INTEGER,
    nb_salles_bain INTEGER,
    superficie NUMERIC,
    meuble BOOLEAN,

    -- Localisation
    quartier TEXT,
    ville TEXT DEFAULT 'Libreville',
    adresse_complete TEXT,

    -- Contact
    telephone TEXT,
    whatsapp TEXT,
    email TEXT,

    -- Métadonnées IA
    ai_confidence NUMERIC,
    ai_summary TEXT,
    ai_is_real_estate BOOLEAN DEFAULT true,
    ai_tags TEXT[] DEFAULT '{}',

    -- Statut
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'sent', 'archived', 'favorite')),
    is_sent_whatsapp BOOLEAN DEFAULT false,
    sent_whatsapp_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, fb_post_id)
);

-- ============================================================
-- 4. CANAUX WHATSAPP
-- ============================================================
CREATE TABLE whatsapp_channels (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    channel_type TEXT DEFAULT 'individual' CHECK (channel_type IN ('individual', 'group')),
    is_active BOOLEAN DEFAULT true,
    -- Filtres automatiques
    filter_type_offre TEXT[] DEFAULT '{}',
    filter_type_bien TEXT[] DEFAULT '{}',
    filter_prix_min NUMERIC,
    filter_prix_max NUMERIC,
    filter_quartiers TEXT[] DEFAULT '{}',
    filter_ville TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. LOGS WHATSAPP
-- ============================================================
CREATE TABLE whatsapp_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    annonce_id UUID REFERENCES annonces(id) ON DELETE SET NULL,
    channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
    phone_number TEXT,
    message_id TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. LOGS DE COLLECTE
-- ============================================================
CREATE TABLE scrape_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    fb_group_id UUID REFERENCES facebook_groups(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0,
    posts_new INTEGER DEFAULT 0,
    posts_duplicate INTEGER DEFAULT 0,
    posts_not_immo INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
    error_message TEXT
);

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX idx_annonces_user_id ON annonces(user_id);
CREATE INDEX idx_annonces_type_bien ON annonces(type_bien);
CREATE INDEX idx_annonces_type_offre ON annonces(type_offre);
CREATE INDEX idx_annonces_prix ON annonces(prix);
CREATE INDEX idx_annonces_quartier ON annonces(quartier);
CREATE INDEX idx_annonces_ville ON annonces(ville);
CREATE INDEX idx_annonces_status ON annonces(status);
CREATE INDEX idx_annonces_created_at ON annonces(created_at DESC);
CREATE INDEX idx_annonces_fb_posted_at ON annonces(fb_posted_at DESC);
CREATE INDEX idx_annonces_is_real_estate ON annonces(ai_is_real_estate);
CREATE INDEX idx_fb_groups_user_id ON facebook_groups(user_id);
CREATE INDEX idx_whatsapp_channels_user_id ON whatsapp_channels(user_id);
CREATE INDEX idx_whatsapp_logs_user_id ON whatsapp_logs(user_id);
CREATE INDEX idx_scrape_logs_user_id ON scrape_logs(user_id);

-- ============================================================
-- TRIGGER updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_fb_groups_updated
    BEFORE UPDATE ON facebook_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_annonces_updated
    BEFORE UPDATE ON annonces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_wa_channels_updated
    BEFORE UPDATE ON whatsapp_channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Facebook Groups
ALTER TABLE facebook_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own groups" ON facebook_groups
    FOR ALL USING (auth.uid() = user_id);

-- Annonces
ALTER TABLE annonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own annonces" ON annonces
    FOR ALL USING (auth.uid() = user_id);

-- WhatsApp Channels
ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own channels" ON whatsapp_channels
    FOR ALL USING (auth.uid() = user_id);

-- WhatsApp Logs
ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own logs" ON whatsapp_logs
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own logs" ON whatsapp_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scrape Logs
ALTER TABLE scrape_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own scrape logs" ON scrape_logs
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scrape logs" ON scrape_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- VUES UTILES
-- ============================================================
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
    a.user_id,
    COUNT(*) AS total_annonces,
    COUNT(*) FILTER (WHERE a.created_at > now() - interval '24 hours') AS nouvelles_24h,
    COUNT(*) FILTER (WHERE a.status = 'favorite') AS favoris,
    COUNT(*) FILTER (WHERE a.is_sent_whatsapp = true) AS envoyees_whatsapp,
    AVG(a.prix) FILTER (WHERE a.type_offre = 'location' AND a.prix > 0) AS prix_moyen_location,
    AVG(a.prix) FILTER (WHERE a.type_offre = 'vente' AND a.prix > 0) AS prix_moyen_vente
FROM annonces a
WHERE a.ai_is_real_estate = true
GROUP BY a.user_id;
