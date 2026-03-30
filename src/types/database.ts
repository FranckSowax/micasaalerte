export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
          plan: "free" | "pro" | "enterprise";
          whatsapp_phone: string | null;
          rapidapi_key: string | null;
          kimi_api_key: string | null;
          whatsapp_phone_number_id: string | null;
          whatsapp_access_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          plan?: "free" | "pro" | "enterprise";
          whatsapp_phone?: string | null;
          rapidapi_key?: string | null;
          kimi_api_key?: string | null;
          whatsapp_phone_number_id?: string | null;
          whatsapp_access_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          plan?: "free" | "pro" | "enterprise";
          whatsapp_phone?: string | null;
          rapidapi_key?: string | null;
          kimi_api_key?: string | null;
          whatsapp_phone_number_id?: string | null;
          whatsapp_access_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      facebook_groups: {
        Row: {
          id: string;
          user_id: string;
          group_id: string;
          group_url: string;
          group_name: string;
          is_active: boolean;
          last_scraped_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          group_id: string;
          group_url: string;
          group_name: string;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          group_id?: string;
          group_url?: string;
          group_name?: string;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      annonces: {
        Row: {
          id: string;
          user_id: string;
          fb_post_id: string;
          fb_post_url: string | null;
          fb_group_id: string | null;
          fb_author_name: string | null;
          fb_author_id: string | null;
          fb_posted_at: string | null;
          raw_text: string;
          raw_images: string[];
          type_bien: string | null;
          type_offre: string | null;
          prix: number | null;
          devise: string;
          nb_pieces: number | null;
          nb_chambres: number | null;
          nb_salles_bain: number | null;
          superficie: number | null;
          meuble: boolean | null;
          quartier: string | null;
          ville: string;
          adresse_complete: string | null;
          telephone: string | null;
          whatsapp: string | null;
          email: string | null;
          ai_confidence: number | null;
          ai_summary: string | null;
          ai_is_real_estate: boolean;
          ai_tags: string[];
          status: "new" | "sent" | "archived" | "favorite";
          is_sent_whatsapp: boolean;
          sent_whatsapp_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          fb_post_id: string;
          fb_post_url?: string | null;
          fb_group_id?: string | null;
          fb_author_name?: string | null;
          fb_author_id?: string | null;
          fb_posted_at?: string | null;
          raw_text: string;
          raw_images?: string[];
          type_bien?: string | null;
          type_offre?: string | null;
          prix?: number | null;
          devise?: string;
          nb_pieces?: number | null;
          nb_chambres?: number | null;
          nb_salles_bain?: number | null;
          superficie?: number | null;
          meuble?: boolean | null;
          quartier?: string | null;
          ville?: string;
          adresse_complete?: string | null;
          telephone?: string | null;
          whatsapp?: string | null;
          email?: string | null;
          ai_confidence?: number | null;
          ai_summary?: string | null;
          ai_is_real_estate?: boolean;
          ai_tags?: string[];
          status?: "new" | "sent" | "archived" | "favorite";
          is_sent_whatsapp?: boolean;
          sent_whatsapp_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          fb_post_id?: string;
          fb_post_url?: string | null;
          fb_group_id?: string | null;
          fb_author_name?: string | null;
          fb_author_id?: string | null;
          fb_posted_at?: string | null;
          raw_text?: string;
          raw_images?: string[];
          type_bien?: string | null;
          type_offre?: string | null;
          prix?: number | null;
          devise?: string;
          nb_pieces?: number | null;
          nb_chambres?: number | null;
          nb_salles_bain?: number | null;
          superficie?: number | null;
          meuble?: boolean | null;
          quartier?: string | null;
          ville?: string;
          adresse_complete?: string | null;
          telephone?: string | null;
          whatsapp?: string | null;
          email?: string | null;
          ai_confidence?: number | null;
          ai_summary?: string | null;
          ai_is_real_estate?: boolean;
          ai_tags?: string[];
          status?: "new" | "sent" | "archived" | "favorite";
          is_sent_whatsapp?: boolean;
          sent_whatsapp_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      whatsapp_channels: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          phone_number: string;
          channel_type: "individual" | "group";
          is_active: boolean;
          filter_type_offre: string[];
          filter_type_bien: string[];
          filter_prix_min: number | null;
          filter_prix_max: number | null;
          filter_quartiers: string[];
          filter_ville: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone_number: string;
          channel_type?: "individual" | "group";
          is_active?: boolean;
          filter_type_offre?: string[];
          filter_type_bien?: string[];
          filter_prix_min?: number | null;
          filter_prix_max?: number | null;
          filter_quartiers?: string[];
          filter_ville?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          phone_number?: string;
          channel_type?: "individual" | "group";
          is_active?: boolean;
          filter_type_offre?: string[];
          filter_type_bien?: string[];
          filter_prix_min?: number | null;
          filter_prix_max?: number | null;
          filter_quartiers?: string[];
          filter_ville?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      whatsapp_logs: {
        Row: {
          id: string;
          user_id: string | null;
          annonce_id: string | null;
          channel_id: string | null;
          phone_number: string | null;
          message_id: string | null;
          status: "pending" | "sent" | "delivered" | "read" | "failed";
          error_message: string | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          annonce_id?: string | null;
          channel_id?: string | null;
          phone_number?: string | null;
          message_id?: string | null;
          status?: "pending" | "sent" | "delivered" | "read" | "failed";
          error_message?: string | null;
          sent_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          annonce_id?: string | null;
          channel_id?: string | null;
          phone_number?: string | null;
          message_id?: string | null;
          status?: "pending" | "sent" | "delivered" | "read" | "failed";
          error_message?: string | null;
          sent_at?: string;
        };
      };
      scrape_logs: {
        Row: {
          id: string;
          user_id: string | null;
          fb_group_id: string | null;
          started_at: string;
          finished_at: string | null;
          posts_found: number;
          posts_new: number;
          posts_duplicate: number;
          posts_not_immo: number;
          status: "running" | "success" | "error";
          error_message: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          fb_group_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          posts_found?: number;
          posts_new?: number;
          posts_duplicate?: number;
          posts_not_immo?: number;
          status?: "running" | "success" | "error";
          error_message?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          fb_group_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          posts_found?: number;
          posts_new?: number;
          posts_duplicate?: number;
          posts_not_immo?: number;
          status?: "running" | "success" | "error";
          error_message?: string | null;
        };
      };
    };
    Views: {
      v_dashboard_stats: {
        Row: {
          user_id: string;
          total_annonces: number;
          nouvelles_24h: number;
          favoris: number;
          envoyees_whatsapp: number;
          prix_moyen_location: number | null;
          prix_moyen_vente: number | null;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type FacebookGroup = Database["public"]["Tables"]["facebook_groups"]["Row"];
export type Annonce = Database["public"]["Tables"]["annonces"]["Row"];
export type WhatsAppChannel = Database["public"]["Tables"]["whatsapp_channels"]["Row"];
export type WhatsAppLog = Database["public"]["Tables"]["whatsapp_logs"]["Row"];
export type ScrapeLog = Database["public"]["Tables"]["scrape_logs"]["Row"];
export type DashboardStats = Database["public"]["Views"]["v_dashboard_stats"]["Row"];
