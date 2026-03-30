"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface ScrapeLog {
  id: string;
  fb_group_id: string | null;
  started_at: string;
  finished_at: string | null;
  posts_found: number;
  posts_new: number;
  posts_duplicate: number;
  posts_not_immo: number;
  status: "running" | "success" | "error";
  error_message: string | null;
  facebook_groups?: { group_name: string } | null;
}

interface RawPost {
  id: string;
  fb_post_id: string;
  fb_post_url: string | null;
  fb_author_name: string | null;
  raw_text: string | null;
  ai_status: string;
  ai_result: Record<string, unknown> | null;
  ai_error: string | null;
  annonce_id: string | null;
  raw_images: string[];
  source_type: string | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  real_estate: { label: "Annonce", color: "bg-green-500/20 text-green-400" },
  not_real_estate: { label: "Pas immo", color: "bg-yellow-500/20 text-yellow-400" },
  duplicate: { label: "Doublon", color: "bg-gray-500/20 text-gray-400" },
  no_text: { label: "Sans texte", color: "bg-gray-500/20 text-gray-400" },
  error: { label: "Erreur IA", color: "bg-red-500/20 text-red-400" },
  pending: { label: "En attente", color: "bg-blue-500/20 text-blue-400" },
};

const logStatusIcon: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-400" />,
  success: <CheckCircle2 className="h-4 w-4 text-green-400" />,
  error: <XCircle className="h-4 w-4 text-red-400" />,
};

export default function HistoriquePage() {
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logPosts, setLogPosts] = useState<Record<string, RawPost[]>>({});
  const [loadingPosts, setLoadingPosts] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("scrape_logs")
        .select("*, facebook_groups(group_name)")
        .order("started_at", { ascending: false })
        .limit(50);
      setLogs((data || []) as unknown as ScrapeLog[]);
      setLoading(false);
    };
    fetchLogs();
  }, []);

  const toggleLog = async (logId: string) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null);
      return;
    }

    setExpandedLogId(logId);

    // Fetch raw_posts for this scrape_log if not cached
    if (!logPosts[logId]) {
      setLoadingPosts(logId);
      const { data } = await supabase
        .from("raw_posts")
        .select("*")
        .eq("scrape_log_id", logId)
        .order("created_at", { ascending: true });
      setLogPosts(prev => ({ ...prev, [logId]: (data || []) as unknown as RawPost[] }));
      setLoadingPosts(null);
    }
  };

  const getDuration = (start: string, end: string | null) => {
    if (!end) return "en cours...";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}min ${Math.round((ms % 60000) / 1000)}s`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historique des collectes</h1>
        <p className="text-muted-foreground mt-1">Détail de chaque collecte avec le résultat post par post</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !logs.length ? (
        <Card><CardContent className="p-12 text-center">
          <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucune collecte effectuée.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            const posts = logPosts[log.id] || [];

            return (
              <Card key={log.id}>
                {/* Log header */}
                <CardContent
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleLog(log.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {logStatusIcon[log.status]}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">
                            {(log as unknown as { facebook_groups?: { group_name: string } }).facebook_groups?.group_name || "Groupe inconnu"}
                          </p>
                          <Badge variant={log.status === "success" ? "default" : log.status === "error" ? "destructive" : "secondary"}>
                            {log.status === "success" ? "Succès" : log.status === "error" ? "Erreur" : "En cours"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {formatDate(log.started_at)} | Durée : {getDuration(log.started_at, log.finished_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{log.posts_found} trouvés</span>
                        <span className="text-green-400">{log.posts_new} nouveaux</span>
                        <span>{log.posts_duplicate} doublons</span>
                        <span className="text-yellow-400">{log.posts_not_immo} pas immo</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>

                  {/* Mobile stats */}
                  <div className="flex sm:hidden items-center gap-3 text-xs text-muted-foreground mt-2">
                    <span>{log.posts_found} trouvés</span>
                    <span className="text-green-400">{log.posts_new} nouveaux</span>
                    <span>{log.posts_duplicate} doublons</span>
                    <span className="text-yellow-400">{log.posts_not_immo} pas immo</span>
                  </div>

                  {log.error_message && (
                    <div className="flex items-start gap-2 mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>{log.error_message}</span>
                    </div>
                  )}
                </CardContent>

                {/* Expanded: post details */}
                {isExpanded && (
                  <div className="border-t border-border px-4 pb-4">
                    {loadingPosts === log.id ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : posts.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        Aucun post enregistré pour cette collecte (collectes anciennes sans tracking détaillé).
                      </p>
                    ) : (
                      <div className="space-y-1 mt-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          {posts.length} post(s) traité(s)
                        </p>
                        {posts.map((post) => {
                          const cfg = statusConfig[post.ai_status] || { label: post.ai_status, color: "" };
                          const aiResult = post.ai_result as Record<string, unknown> | null;

                          return (
                            <div key={post.id} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                              <Badge className={`shrink-0 text-[10px] ${cfg.color}`}>
                                {cfg.label}
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <p className="text-muted-foreground truncate">
                                  {post.raw_text?.substring(0, 120) || "(vide)"}
                                </p>
                                {post.ai_status === "real_estate" && aiResult && (
                                  <div className="flex items-center gap-2 mt-1 text-foreground">
                                    {aiResult.type_offre ? <span className="capitalize">{String(aiResult.type_offre)}</span> : null}
                                    {aiResult.type_bien ? <span>- {String(aiResult.type_bien)}</span> : null}
                                    {aiResult.prix ? <span className="text-primary">{Number(aiResult.prix).toLocaleString()} FCFA</span> : null}
                                    {aiResult.quartier ? <span className="text-muted-foreground">| {String(aiResult.quartier)}</span> : null}
                                  </div>
                                )}
                                {post.ai_error && (
                                  <p className="text-destructive mt-0.5">{post.ai_error}</p>
                                )}
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                {post.raw_images?.length > 0 && (
                                  <span className="text-muted-foreground">{post.raw_images.length} img</span>
                                )}
                                {post.annonce_id && (
                                  <a href={`/annonces/${post.annonce_id}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>
                                    voir
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
