"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Play, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, UserCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface AgentProfile {
  id: string;
  profile_id: string;
  profile_url: string;
  profile_name: string;
  is_active: boolean;
  last_scraped_at: string | null;
  created_at: string;
}

interface ScrapeDetail {
  postId: string;
  status: string;
  text: string;
  type?: string;
  prix?: number;
  quartier?: string;
  error?: string;
  images?: number;
}

interface ScrapeResult {
  agent: string;
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

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scrapeResults, setScrapeResults] = useState<ScrapeResult[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [memberUrl, setMemberUrl] = useState("");
  const [memberScraping, setMemberScraping] = useState(false);
  const [memberResult, setMemberResult] = useState<Record<string, unknown> | null>(null);
  const supabase = createClient();

  const fetchAgents = async () => {
    const { data } = await supabase
      .from("agent_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setAgents((data || []) as unknown as AgentProfile[]);
    setLoading(false);
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setAdding(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Session expirée"); setAdding(false); return; }

    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_url: newUrl, profile_name: newName }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
    } else {
      setNewUrl(""); setNewName("");
      setSuccess("Profil agent ajouté !");
      fetchAgents();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce profil ?")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    fetchAgents();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    fetchAgents();
  };

  const handleScrape = async (agentId?: string) => {
    setScraping(agentId || "all");
    setError(""); setSuccess(""); setScrapeResults(null);
    try {
      const res = await fetch("/api/scrape-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
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

        if (errors.length > 0) setError(errors.map(r => `${r.agent}: ${r.error}`).join(" | "));

        const parts = [`${totalFound} post(s) trouvé(s)`];
        if (totalNew > 0) parts.push(`${totalNew} annonce(s) ajoutée(s)`);
        if (totalNotImmo > 0) parts.push(`${totalNotImmo} non-immobilier`);
        if (totalDup > 0) parts.push(`${totalDup} doublon(s)`);
        if (totalErr > 0) parts.push(`${totalErr} erreur(s) IA`);
        setSuccess(`Collecte terminée ! ${parts.join(", ")}.`);
        fetchAgents();
      }
    } catch {
      setError("Erreur de connexion au serveur");
    }
    setScraping(null);
  };

  const parseMemberUrl = (url: string) => {
    // https://www.facebook.com/groups/985585794841161/user/61550791965459/
    const match = url.match(/facebook\.com\/groups\/([^/]+)\/user\/([^/?]+)/);
    if (match) return { groupId: match[1], memberId: match[2] };
    return null;
  };

  const handleMemberScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setMemberResult(null);

    const parsed = parseMemberUrl(memberUrl);
    if (!parsed) {
      setError("URL invalide. Format attendu : https://facebook.com/groups/GROUP_ID/user/USER_ID/");
      return;
    }

    setMemberScraping(true);
    try {
      const res = await fetch("/api/scrape-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: parsed.groupId, memberId: parsed.memberId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la collecte");
      } else {
        setMemberResult(data);
        const parts = [`${data.postsFound} posts scannés dans le groupe`, `${data.postsFromMember} de ce membre`];
        if (data.postsNew > 0) parts.push(`${data.postsNew} annonce(s) ajoutée(s)`);
        if (data.postsNotImmo > 0) parts.push(`${data.postsNotImmo} pas immobilier`);
        if (data.postsDuplicate > 0) parts.push(`${data.postsDuplicate} doublon(s)`);
        setSuccess(`Collecte terminée ! ${parts.join(", ")}. (${data.apiCalls?.rapidapi} req RapidAPI, ${data.apiCalls?.kimi} req Kimi)`);
      }
    } catch {
      setError("Erreur de connexion");
    }
    setMemberScraping(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agents immobiliers</h1>
          <p className="text-muted-foreground mt-1">Surveillez les publications des profils Facebook d&apos;agents</p>
        </div>
        <Button onClick={() => handleScrape()} disabled={!!scraping}>
          {scraping === "all" ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Collecte...</>
          ) : (
            <><Play className="h-4 w-4 mr-2" /> Collecter tout</>
          )}
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /><span>{success}</span>
        </div>
      )}

      {/* Scrape results */}
      {scrapeResults && scrapeResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Détails de la collecte</CardTitle>
              <div className="flex items-center gap-3">
                {scrapeResults.map(r => r.apiCalls && (
                  <span key={r.agent} className="text-xs text-muted-foreground">
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
                <div key={result.agent} className="space-y-2">
                  <p className="text-sm font-medium">{result.agent}</p>
                  {result.error ? (
                    <p className="text-sm text-destructive">{result.error}</p>
                  ) : (
                    <div className="space-y-1">
                      {result.details?.map((detail, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                          <Badge className={`shrink-0 text-[10px] ${statusLabels[detail.status]?.color || ""}`}>
                            {statusLabels[detail.status]?.label || detail.status}
                          </Badge>
                          <span className="flex-1 text-muted-foreground truncate">{detail.text}...</span>
                          {detail.type && <span className="text-foreground shrink-0">{detail.type}</span>}
                          {detail.prix && <span className="text-primary shrink-0">{detail.prix.toLocaleString()} FCFA</span>}
                          {detail.images ? <span className="text-muted-foreground shrink-0">{detail.images} img</span> : null}
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

      {/* Add agent form */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Ajouter un profil agent</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input placeholder="Nom de l'agent" value={newName} onChange={(e) => setNewName(e.target.value)} className="sm:w-48" required />
            <Input placeholder="https://facebook.com/nom.agent ou profile.php?id=123" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} className="flex-1" required />
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Scrape member from group */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scraper un membre dans un groupe</CardTitle>
          <p className="text-sm text-muted-foreground">
            Collez le lien Facebook du type : facebook.com/groups/XXX/user/YYY
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleMemberScrape} className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="https://facebook.com/groups/123456/user/789012"
              value={memberUrl}
              onChange={(e) => setMemberUrl(e.target.value)}
              className="flex-1"
              required
            />
            <Button type="submit" disabled={memberScraping}>
              {memberScraping ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scan en cours...</>
              ) : (
                <><Play className="h-4 w-4 mr-1" /> Scraper</>
              )}
            </Button>
          </form>
          {memberResult && (memberResult.details as Record<string, unknown>[])?.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Posts du membre :</p>
              {(memberResult.details as Record<string, unknown>[]).map((detail, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                  <Badge className={`shrink-0 text-[10px] ${statusLabels[detail.status as string]?.color || ""}`}>
                    {statusLabels[detail.status as string]?.label || String(detail.status)}
                  </Badge>
                  <span className="flex-1 text-muted-foreground truncate">{String(detail.text)}...</span>
                  {detail.type ? <span className="text-foreground shrink-0">{String(detail.type)}</span> : null}
                  {detail.prix ? <span className="text-primary shrink-0">{Number(detail.prix).toLocaleString()} FCFA</span> : null}
                  {detail.images ? <span className="text-muted-foreground shrink-0">{String(detail.images)} img</span> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agents list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !agents.length ? (
        <Card><CardContent className="p-12 text-center">
          <UserCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucun profil agent ajouté. Collez l&apos;URL du profil Facebook d&apos;un agent immobilier.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <UserCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                    <p className="font-medium truncate">{agent.profile_name}</p>
                    <Badge variant={agent.is_active ? "default" : "secondary"} className="shrink-0">
                      {agent.is_active ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    ID: {agent.profile_id} | Dernière collecte : {agent.last_scraped_at ? formatDate(agent.last_scraped_at) : "Jamais"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(agent.id, agent.is_active)}>
                    {agent.is_active ? "Désactiver" : "Activer"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleScrape(agent.id)} disabled={!!scraping}>
                    {scraping === agent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(agent.id)} className="text-destructive hover:text-destructive">
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
