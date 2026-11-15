-- ============================================================
-- SCHEMA SUPABASE — ImmoTracker SaaS
-- Multi-tenant avec RLS
-- Rejouable : peut être exécuté tel quel sur une base neuve ou existante.
-- Sur une base existante, les tables déjà présentes ne sont PAS modifiées.
-- ============================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
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
CREATE TABLE IF NOT EXISTS facebook_groups (
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
CREATE TABLE IF NOT EXISTS annonces (
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
CREATE TABLE IF NOT EXISTS whatsapp_channels (
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
CREATE TABLE IF NOT EXISTS whatsapp_logs (
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
CREATE TABLE IF NOT EXISTS scrape_logs (
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
CREATE INDEX IF NOT EXISTS idx_annonces_user_id ON annonces(user_id);
CREATE INDEX IF NOT EXISTS idx_annonces_type_bien ON annonces(type_bien);
CREATE INDEX IF NOT EXISTS idx_annonces_type_offre ON annonces(type_offre);
CREATE INDEX IF NOT EXISTS idx_annonces_prix ON annonces(prix);
CREATE INDEX IF NOT EXISTS idx_annonces_quartier ON annonces(quartier);
CREATE INDEX IF NOT EXISTS idx_annonces_ville ON annonces(ville);
CREATE INDEX IF NOT EXISTS idx_annonces_status ON annonces(status);
CREATE INDEX IF NOT EXISTS idx_annonces_created_at ON annonces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annonces_fb_posted_at ON annonces(fb_posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_annonces_is_real_estate ON annonces(ai_is_real_estate);
CREATE INDEX IF NOT EXISTS idx_fb_groups_user_id ON facebook_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_user_id ON whatsapp_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_user_id ON whatsapp_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_user_id ON scrape_logs(user_id);

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

DROP TRIGGER IF EXISTS tr_profiles_updated ON profiles;
CREATE TRIGGER tr_profiles_updated
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_fb_groups_updated ON facebook_groups;
CREATE TRIGGER tr_fb_groups_updated
    BEFORE UPDATE ON facebook_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_annonces_updated ON annonces;
CREATE TRIGGER tr_annonces_updated
    BEFORE UPDATE ON annonces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_wa_channels_updated ON whatsapp_channels;
CREATE TRIGGER tr_wa_channels_updated
    BEFORE UPDATE ON whatsapp_channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Facebook Groups
ALTER TABLE facebook_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own groups" ON facebook_groups;
CREATE POLICY "Users can CRUD own groups" ON facebook_groups
    FOR ALL USING (auth.uid() = user_id);

-- Annonces
ALTER TABLE annonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own annonces" ON annonces;
CREATE POLICY "Users can CRUD own annonces" ON annonces
    FOR ALL USING (auth.uid() = user_id);

-- WhatsApp Channels
ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own channels" ON whatsapp_channels;
CREATE POLICY "Users can CRUD own channels" ON whatsapp_channels
    FOR ALL USING (auth.uid() = user_id);

-- WhatsApp Logs
ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own logs" ON whatsapp_logs;
CREATE POLICY "Users can view own logs" ON whatsapp_logs
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own logs" ON whatsapp_logs;
CREATE POLICY "Users can insert own logs" ON whatsapp_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scrape Logs
ALTER TABLE scrape_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own scrape logs" ON scrape_logs;
CREATE POLICY "Users can view own scrape logs" ON scrape_logs
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own scrape logs" ON scrape_logs;
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

-- ============================================================
-- ============================================================
-- EXTENSION DU SCHÉMA — tables ajoutées après la v1
-- (agents, contributeurs, TikTok, données brutes, demandes clients, chatbot)
--
-- Cette section est idempotente : elle peut être rejouée sur une base
-- existante. Attention : CREATE TABLE IF NOT EXISTS ne modifie pas une
-- table déjà présente — si votre base a été créée à la main, comparez
-- les colonnes avant de vous y fier.
-- ============================================================
-- ============================================================

-- ============================================================
-- 7. PROFILS D'AGENTS IMMOBILIERS (profils Facebook suivis)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    profile_id TEXT NOT NULL,
    profile_url TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, profile_id)
);

-- ============================================================
-- 8. CONTRIBUTEURS (membres de groupes suivis individuellement)
-- ============================================================
CREATE TABLE IF NOT EXISTS contributors (
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

-- ============================================================
-- 9. COMPTES TIKTOK
-- ============================================================
CREATE TABLE IF NOT EXISTS tiktok_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    tiktok_handle TEXT NOT NULL,
    tiktok_url TEXT NOT NULL,
    sec_uid TEXT,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    posts_found INTEGER DEFAULT 0,
    annonces_created INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, tiktok_handle)
);

-- ============================================================
-- 10. DONNÉES BRUTES (tous les posts collectés, avant/après IA)
-- ============================================================
CREATE TABLE IF NOT EXISTS raw_posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

    -- Origine
    source_type TEXT DEFAULT 'group' CHECK (source_type IN ('group', 'profile', 'tiktok')),
    fb_group_id UUID REFERENCES facebook_groups(id) ON DELETE SET NULL,
    agent_profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL,
    scrape_log_id UUID REFERENCES scrape_logs(id) ON DELETE SET NULL,

    -- Post
    fb_post_id TEXT NOT NULL,
    fb_post_url TEXT,
    fb_author_name TEXT,
    fb_author_id TEXT,
    fb_posted_at TIMESTAMPTZ,
    raw_text TEXT,
    raw_images TEXT[] DEFAULT '{}',
    raw_api_data JSONB,

    -- Analyse IA
    ai_status TEXT DEFAULT 'pending'
        CHECK (ai_status IN ('pending', 'real_estate', 'not_real_estate', 'error', 'no_text', 'duplicate')),
    ai_result JSONB,
    ai_error TEXT,
    annonce_id UUID REFERENCES annonces(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, fb_post_id)
);

-- ============================================================
-- 11. DEMANDES CLIENTS (critères de recherche d'un client final)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_demands (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    client_phone TEXT NOT NULL,
    client_name TEXT,
    is_active BOOLEAN DEFAULT true,
    filter_type_offre TEXT[] DEFAULT '{}',
    filter_type_bien TEXT[] DEFAULT '{}',
    filter_prix_min NUMERIC,
    filter_prix_max NUMERIC,
    filter_nb_chambres_min INTEGER,
    filter_quartiers TEXT[] DEFAULT '{}',
    filter_ville TEXT DEFAULT 'Libreville',
    filter_meuble BOOLEAN,
    exigences TEXT,
    source TEXT DEFAULT 'admin' CHECK (source IN ('chatbot', 'form', 'admin')),
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, client_phone)
);

-- ============================================================
-- 12. ENVOIS LIÉS AUX DEMANDES (anti-doublon annonce ↔ demande)
-- ============================================================
CREATE TABLE IF NOT EXISTS client_demand_sends (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    demand_id UUID REFERENCES client_demands(id) ON DELETE CASCADE NOT NULL,
    annonce_id UUID REFERENCES annonces(id) ON DELETE CASCADE NOT NULL,
    message_id TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    sent_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 13. CONVERSATIONS DU CHATBOT WHATSAPP
-- ============================================================
CREATE TABLE IF NOT EXISTS chatbot_conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    client_phone TEXT NOT NULL,
    conversation_state TEXT NOT NULL DEFAULT 'welcome',
    context JSONB DEFAULT '{}'::jsonb,
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, client_phone)
);

-- ============================================================
-- MISE À NIVEAU DES TABLES EXISTANTES
-- CREATE TABLE IF NOT EXISTS ne touche pas une table déjà présente :
-- on ajoute ici les colonnes dont le code a besoin si elles manquent.
-- Sans effet sur une base neuve.
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rapidapi_key TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kimi_api_key TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT;

ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'group';
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS fb_group_id UUID REFERENCES facebook_groups(id) ON DELETE SET NULL;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS agent_profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS scrape_log_id UUID REFERENCES scrape_logs(id) ON DELETE SET NULL;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS fb_author_id TEXT;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS raw_api_data JSONB;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS ai_result JSONB;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS ai_error TEXT;
ALTER TABLE raw_posts ADD COLUMN IF NOT EXISTS annonce_id UUID REFERENCES annonces(id) ON DELETE SET NULL;

ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS filter_meuble BOOLEAN;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS exigences TEXT;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'admin';
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- ============================================================
-- INDEX (extension)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_id ON agent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_contributors_user_id ON contributors(user_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_user_id ON tiktok_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_raw_posts_user_created ON raw_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_posts_ai_status ON raw_posts(ai_status);
CREATE INDEX IF NOT EXISTS idx_raw_posts_scrape_log_id ON raw_posts(scrape_log_id);
CREATE INDEX IF NOT EXISTS idx_client_demands_user_active ON client_demands(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_client_demand_sends_demand_id ON client_demand_sends(demand_id);
CREATE INDEX IF NOT EXISTS idx_client_demand_sends_annonce_id ON client_demand_sends(annonce_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_user_id ON chatbot_conversations(user_id);
-- Le webhook WhatsApp retrouve le compte par son phone_number_id
CREATE INDEX IF NOT EXISTS idx_profiles_wa_phone_number_id ON profiles(whatsapp_phone_number_id);

-- ============================================================
-- TRIGGER updated_at (extension)
-- ============================================================
DROP TRIGGER IF EXISTS tr_agent_profiles_updated ON agent_profiles;
CREATE TRIGGER tr_agent_profiles_updated
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_contributors_updated ON contributors;
CREATE TRIGGER tr_contributors_updated
    BEFORE UPDATE ON contributors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_tiktok_accounts_updated ON tiktok_accounts;
CREATE TRIGGER tr_tiktok_accounts_updated
    BEFORE UPDATE ON tiktok_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS tr_client_demands_updated ON client_demands;
CREATE TRIGGER tr_client_demands_updated
    BEFORE UPDATE ON client_demands
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (extension)
-- Les écritures serveur (collecte, crons, webhook, formulaire public)
-- passent par la clé service, qui contourne RLS.
-- ============================================================
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own agent profiles" ON agent_profiles;
CREATE POLICY "Users can CRUD own agent profiles" ON agent_profiles
    FOR ALL USING (auth.uid() = user_id);

ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own contributors" ON contributors;
CREATE POLICY "Users can CRUD own contributors" ON contributors
    FOR ALL USING (auth.uid() = user_id);

ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own tiktok accounts" ON tiktok_accounts;
CREATE POLICY "Users can CRUD own tiktok accounts" ON tiktok_accounts
    FOR ALL USING (auth.uid() = user_id);

ALTER TABLE raw_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own raw posts" ON raw_posts;
CREATE POLICY "Users can view own raw posts" ON raw_posts
    FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE client_demands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own client demands" ON client_demands;
CREATE POLICY "Users can CRUD own client demands" ON client_demands
    FOR ALL USING (auth.uid() = user_id);

ALTER TABLE client_demand_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own demand sends" ON client_demand_sends;
CREATE POLICY "Users can view own demand sends" ON client_demand_sends
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM client_demands d
            WHERE d.id = client_demand_sends.demand_id AND d.user_id = auth.uid()
        )
    );

ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own conversations" ON chatbot_conversations;
CREATE POLICY "Users can view own conversations" ON chatbot_conversations
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- FICHE NORMALISÉE ET MATCHING (rejouable)
-- ============================================================

-- Détails de l'annonce sans colonne dédiée : charges, caution, périodicité, pays,
-- salons, climatisation, parking, disponibilité, confiance par champ, extraits de
-- la source justifiant chaque valeur, champs à vérifier.
ALTER TABLE annonces ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- Préférences souples de l'abonné (elles pèsent dans le score, sans bloquer)
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS filter_climatise BOOLEAN;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS filter_parking BOOLEAN;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS filter_surface_min NUMERIC;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS keywords_include TEXT[] DEFAULT '{}';
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS keywords_exclude TEXT[] DEFAULT '{}';

-- Réglages d'alerte : seuil de score (0-100), envoi immédiat ou résumé quotidien,
-- plafond par jour, plage silencieuse en heures locales (Africa/Libreville).
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS min_score INTEGER DEFAULT 50;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS alert_mode TEXT DEFAULT 'immediate';
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS max_alerts_per_day INTEGER DEFAULT 5;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS quiet_start SMALLINT DEFAULT 21;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS quiet_end SMALLINT DEFAULT 7;

-- Clé d'unicité abonné + annonce + version : empêche tout doublon d'alerte.
ALTER TABLE client_demand_sends ADD COLUMN IF NOT EXISTS annonce_version INTEGER NOT NULL DEFAULT 1;
DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_client_demand_sends_key
        ON client_demand_sends(demand_id, annonce_id, annonce_version);
EXCEPTION WHEN unique_violation THEN
    -- Des doublons existent déjà : l'index n'est pas créé, le reste du script continue.
    RAISE NOTICE 'uq_client_demand_sends_key non créé : doublons existants dans client_demand_sends';
END $$;

-- ============================================================
-- MATCHING PAR RAYON (rejouable)
-- Sans ces colonnes, le rayon est de 5 km autour du centre des quartiers préférés.
-- ============================================================
-- Point précis autour duquel l'abonné cherche (facultatif)
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS geo_lat NUMERIC;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS geo_lon NUMERIC;
-- Rayon de recherche, en kilomètres
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS geo_radius_km NUMERIC DEFAULT 5;

-- ============================================================
-- ESPACE CLIENT PAR LIEN PERSONNEL (rejouable)
-- ============================================================
-- Jeton du lien personnel, et empreinte de l'appareil qui l'a ouvert en premier
-- (le lien est refusé sur un autre appareil).
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS device_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_demands_access_token ON client_demands(access_token);

-- Tri fait par le client sur chaque annonce reçue : à trier, retenue, supprimée
ALTER TABLE client_demand_sends ADD COLUMN IF NOT EXISTS client_status TEXT DEFAULT 'new';
ALTER TABLE client_demand_sends ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
DO $$
BEGIN
    ALTER TABLE client_demand_sends
        ADD CONSTRAINT client_demand_sends_client_status_check CHECK (client_status IN ('new', 'kept', 'removed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Plafond quotidien : les alertes sont désormais un lien vers l'espace client (un message
-- par heure au plus), le plafond compte donc les annonces ajoutées, plus les messages.
-- L'ancienne valeur par défaut (5) est relevée à 30 ; aucun écran ne permettait de la régler.
ALTER TABLE client_demands ALTER COLUMN max_alerts_per_day SET DEFAULT 30;
UPDATE client_demands SET max_alerts_per_day = 30 WHERE max_alerts_per_day = 5;

-- Plafond relevé à 100 : toutes les annonces en attente partent en un seul message, le plafond
-- n'est plus qu'un filet de sécurité. Le code applique déjà 100 au minimum ; ces lignes alignent la base.
ALTER TABLE client_demands ALTER COLUMN max_alerts_per_day SET DEFAULT 100;
UPDATE client_demands SET max_alerts_per_day = 100 WHERE max_alerts_per_day IN (5, 30);

-- ============================================================
-- ABONNEMENT CLIENT (rejouable)
-- ============================================================
-- Essai gratuit de 24 h à la création de la demande, puis 1 000 FCFA pour 2 jours.
-- Les clients déjà inscrits au moment de la migration reçoivent eux aussi 24 h d'essai.
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours');
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ;
-- Dernier message « accès terminé » envoyé : un seul par période.
ALTER TABLE client_demands ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMPTZ;

-- Paiements déclarés par les clients (référence Mobile Money) et validés par l'agent.
CREATE TABLE IF NOT EXISTS subscription_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id UUID REFERENCES client_demands(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    amount INTEGER NOT NULL DEFAULT 1000,
    days INTEGER NOT NULL DEFAULT 2,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_demand ON subscription_payments(demand_id, status);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_user ON subscription_payments(user_id, status);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can CRUD own subscription payments" ON subscription_payments;
CREATE POLICY "Users can CRUD own subscription payments" ON subscription_payments
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
