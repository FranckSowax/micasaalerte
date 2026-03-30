"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Play, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { FacebookGroup } from "@/types/database";

interface ScrapeDetail {
  postId: string;
  status: string;
  text: string;
  type?: string;
  prix?: number;
  quartier?: string;
  reason?: string;
  error?: string;
}

interface ScrapeResult {
  group: string;
  postsFound?: number;
  postsNew?: number;
  postsDuplicate?: number;
  postsNotImmo?: number;
  postsNoText?: number;
  postsError?: number;
  apiCalls?: { rapidapi: number; kimi: number };
  details?: ScrapeDetail[];
  error?: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  new_annonce: { label: "Nouvelle annonce", color: "bg-green-500/20 text-green-400" },
  not_real_estate: { label: "Pas immobilier", color: "bg-yellow-500/20 text-yellow-400" },
  duplicate: { label: "Doublon", color: "bg-gray-500/20 text-gray-400" },
  no_text: { label: "Sans texte", color: "bg-gray-500/20 text-gray-400" },
  ai_error: { label: "Erreur IA", color: "bg-red-500/20 text-red-400" },
};

export default function GroupesPage() {
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [newGroupUrl, setNewGroupUrl] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scrapeResults, setScrapeResults] = useState<ScrapeResult[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const supabase = createClient();

  const fetchGroups = async () => {
    const { data } = await supabase
      .from("facebook_groups")
      .select("*")
      .order("created_at", { ascending: false });
    setGroups((data || []) as unknown as FacebookGroup[]);
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, []);

  const extractGroupId = (url: string): string | null => {
    const match = url.match(/facebook\.com\/groups\/([^/?]+)/);
    return match ? match[1] : null;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setAdding(true);

    const groupId = extractGroupId(newGroupUrl);
    if (!groupId) {
      setError("URL invalide. Format : https://facebook.com/groups/123456");
      setAdding(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Session expirée"); setAdding(false); return; }

    const { error: insertError } = await supabase.from("facebook_groups").insert({
      user_id: user.id, group_id: groupId, group_url: newGroupUrl,
      group_name: newGroupName || `Groupe ${groupId}`,
    });

    if (insertError) {
      setError(insertError.message.includes("duplicate") ? "Ce groupe est déjà ajouté" : insertError.message);
    } else {
      setNewGroupUrl(""); setNewGroupName("");
      setSuccess("Groupe ajouté !");
      fetchGroups();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce groupe ?")) return;
    await supabase.from("facebook_groups").delete().eq("id", id);
    fetchGroups();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from("facebook_groups").update({ is_active: !isActive }).eq("id", id);
    fetchGroups();
  };

  const handleScrape = async (groupId?: string) => {
    setScraping(groupId || "all");
    setError(""); setSuccess(""); setScrapeResults(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la collecte");
      } else {
        const results: ScrapeResult[] = data.results || [];
        setScrapeResults(results);

        const totalNew = results.reduce((s, r) => s + (r.postsNew || 0), 0);
        const totalFound = results.reduce((s, r) => s + (r.postsFound || 0), 0);
        const totalNotImmo = results.reduce((s, r) => s + (r.postsNotImmo || 0), 0);
        const totalDup = results.reduce((s, r) => s + (r.postsDuplicate || 0), 0);
        const totalErr = results.reduce((s, r) => s + (r.postsError || 0), 0);
        const errors = results.filter(r => r.error);

        if (errors.length > 0) {
          setError(errors.map(r => `${r.group}: ${r.error}`).join(" | "));
        }

        const parts = [`${totalFound} post(s) trouvé(s)`];
        if (totalNew > 0) parts.push(`${totalNew} annonce(s) ajoutée(s)`);
        if (totalNotImmo > 0) parts.push(`${totalNotImmo} non-immobilier`);
        if (totalDup > 0) parts.push(`${totalDup} doublon(s)`);
        if (totalErr > 0) parts.push(`${totalErr} erreur(s) IA`);
        setSuccess(`Collecte terminée ! ${parts.join(", ")}.`);
        fetchGroups();
      }
    } catch {
      setError("Erreur de connexion au serveur");
    }
    setScraping(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Groupes Facebook</h1>
          <p className="text-muted-foreground mt-1">Gérez les groupes à surveiller</p>
        </div>
        <Button onClick={() => handleScrape()} disabled={!!scraping}>
          {scraping === "all" ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Collecte...</>
          ) : (
            <><Play className="h-4 w-4 mr-2" /> Collecter tout</>
          )}
        </Button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Scrape results detail */}
      {scrapeResults && scrapeResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Détails de la collecte</CardTitle>
              <div className="flex items-center gap-3">
                {scrapeResults.map(r => r.apiCalls && (
                  <span key={r.group} className="text-xs text-muted-foreground">
                    API : {r.apiCalls.rapidapi} req RapidAPI, {r.apiCalls.kimi} req Kimi
                  </span>
                ))}
                {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
          {showDetails && (
            <CardContent>
              {scrapeResults.map((result) => (
                <div key={result.group} className="space-y-2">
                  <p className="text-sm font-medium">{result.group}</p>
                  {result.error ? (
                    <p className="text-sm text-destructive">{result.error}</p>
                  ) : (
                    <div className="space-y-1">
                      {result.details?.map((detail, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                          <Badge className={`shrink-0 text-[10px] ${statusLabels[detail.status]?.color || "bg-gray-500/20 text-gray-400"}`}>
                            {statusLabels[detail.status]?.label || detail.status}
                          </Badge>
                          <span className="flex-1 text-muted-foreground truncate">{detail.text}...</span>
                          {detail.type && <span className="text-foreground shrink-0">{detail.type}</span>}
                          {detail.prix && <span className="text-primary shrink-0">{detail.prix?.toLocaleString()} FCFA</span>}
                          {detail.reason && <span className="text-yellow-400 shrink-0">{detail.reason}</span>}
                          {detail.error && <span className="text-destructive shrink-0">{detail.error.substring(0, 50)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Add group form */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Ajouter un groupe</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input placeholder="Nom du groupe" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="sm:w-48" required />
            <Input placeholder="https://facebook.com/groups/..." value={newGroupUrl} onChange={(e) => setNewGroupUrl(e.target.value)} className="flex-1" required />
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Groups list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !groups.length ? (
        <Card><CardContent className="p-12 text-center"><p className="text-muted-foreground">Aucun groupe ajouté.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{group.group_name}</p>
                    <Badge variant={group.is_active ? "default" : "secondary"} className="shrink-0">
                      {group.is_active ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    ID: {group.group_id} | Dernière collecte : {group.last_scraped_at ? formatDate(group.last_scraped_at) : "Jamais"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(group.id, group.is_active)}>
                    {group.is_active ? "Désactiver" : "Activer"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleScrape(group.id)} disabled={!!scraping}>
                    {scraping === group.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(group.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
