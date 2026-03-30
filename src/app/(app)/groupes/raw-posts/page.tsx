"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface RawPost {
  id: string;
  fb_post_id: string;
  fb_post_url: string | null;
  fb_author_name: string | null;
  raw_text: string | null;
  raw_images: string[];
  fb_posted_at: string | null;
  ai_status: string;
  ai_result: Record<string, unknown> | null;
  ai_error: string | null;
  annonce_id: string | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: "bg-blue-500/20 text-blue-400" },
  real_estate: { label: "Immobilier", color: "bg-green-500/20 text-green-400" },
  not_real_estate: { label: "Pas immobilier", color: "bg-yellow-500/20 text-yellow-400" },
  error: { label: "Erreur IA", color: "bg-red-500/20 text-red-400" },
  no_text: { label: "Sans texte", color: "bg-gray-500/20 text-gray-400" },
  duplicate: { label: "Doublon", color: "bg-gray-500/20 text-gray-400" },
};

export default function RawPostsPage() {
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const fetchPosts = async () => {
      let query = supabase
        .from("raw_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter) {
        query = query.eq("ai_status", filter);
      }

      const { data } = await query;
      setPosts((data || []) as unknown as RawPost[]);
      setLoading(false);
    };
    fetchPosts();
  }, [filter]);

  const counts = posts.reduce((acc, p) => {
    acc[p.ai_status] = (acc[p.ai_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/groupes">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Données brutes collectées</h1>
          <p className="text-muted-foreground mt-1">Tous les posts Facebook récupérés, avant et après analyse IA</p>
        </div>
      </div>

      {/* Filter badges */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant={filter === "" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => { setFilter(""); setLoading(true); }}
        >
          Tous ({posts.length})
        </Badge>
        {Object.entries(statusConfig).map(([key, { label, color }]) => (
          <Badge
            key={key}
            className={`cursor-pointer ${filter === key ? color : "bg-secondary text-secondary-foreground"}`}
            onClick={() => { setFilter(key); setLoading(true); }}
          >
            {label} {counts[key] ? `(${counts[key]})` : ""}
          </Badge>
        ))}
      </div>

      {/* Posts */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !posts.length ? (
        <Card><CardContent className="p-12 text-center"><p className="text-muted-foreground">Aucun post collecté. Lancez une collecte depuis la page Groupes.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const isExpanded = expandedId === post.id;
            const cfg = statusConfig[post.ai_status] || { label: post.ai_status, color: "bg-gray-500/20 text-gray-400" };
            const aiResult = post.ai_result as Record<string, unknown> | null;

            return (
              <Card key={post.id} className="overflow-hidden">
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : post.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={cfg.color}>{cfg.label}</Badge>
                        {post.fb_author_name && (
                          <span className="text-xs text-muted-foreground">par {post.fb_author_name}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDate(post.created_at)}</span>
                      </div>
                      <p className="text-sm text-foreground/80 line-clamp-2">
                        {post.raw_text || "(aucun texte)"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {post.annonce_id && (
                        <Link href={`/annonces/${post.annonce_id}`} onClick={(e) => e.stopPropagation()}>
                          <Badge variant="default" className="cursor-pointer">Voir annonce</Badge>
                        </Link>
                      )}
                      {post.fb_post_url && (
                        <a href={post.fb_post_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                          <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </a>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-4">
                      {/* Raw text */}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">TEXTE BRUT</p>
                        <p className="text-sm bg-background p-3 rounded whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {post.raw_text || "(vide)"}
                        </p>
                      </div>

                      {/* AI Result */}
                      {aiResult && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">RÉSULTAT IA (JSON)</p>
                          <pre className="text-xs bg-background p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                            {JSON.stringify(aiResult, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* AI Error */}
                      {post.ai_error && (
                        <div>
                          <p className="text-xs font-medium text-destructive mb-1">ERREUR IA</p>
                          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded">{post.ai_error}</p>
                        </div>
                      )}

                      {/* Images */}
                      {post.raw_images?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">IMAGES ({post.raw_images.length})</p>
                          <div className="flex flex-wrap gap-2">
                            {post.raw_images.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-xs">
                                {url}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Meta */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Post ID: {post.fb_post_id}</span>
                        <span>Publié: {post.fb_posted_at ? formatDate(post.fb_posted_at) : "N/A"}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
