"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, Play, Loader2, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Video, Square,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { TikTokAccount } from "@/types/database";

interface ScrapeDetail {
  postId: string;
  status: string;
  text: string;
  type?: string;
  prix?: number;
  images?: number;
  error?: string;
}

interface ScrapeResult {
  account: string;
  postsFound: number;
  postsNew: number;
  postsDuplicate: number;
  postsNotImmo: number;
  postsError: number;
  apiCalls: { rapidapi: number; kimi: number };
  details: ScrapeDetail[];
  error?: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  new_annonce: { label: "Annonce", color: "bg-green-500/20 text-green-400" },
  not_real_estate: { label: "Pas immo", color: "bg-yellow-500/20 text-yellow-400" },
  duplicate: { label: "Doublon", color: "bg-gray-500/20 text-gray-400" },
  no_text: { label: "Sans texte", color: "bg-gray-500/20 text-gray-400" },
  ai_error: { label: "Erreur IA", color: "bg-red-500/20 text-red-400" },
};

export default function TikTokPage() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scrapeResults, setScrapeResults] = useState<ScrapeResult[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const cancelRef = useRef(false);
  const supabase = createClient();

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from("tiktok_accounts")
      .select("*")
      .order("created_at", { ascending: false });
    setAccounts((data || []) as unknown as TikTokAccount[]);
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setAdding(true);

    const res = await fetch("/api/tiktok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktok_url: newUrl }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
    } else {
      setNewUrl("");
      setSuccess("Compte TikTok ajouté !");
      fetchAccounts();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce compte ?")) return;
    await fetch(`/api/tiktok/${id}`, { method: "DELETE" });
    fetchAccounts();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch(`/api/tiktok/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    fetchAccounts();
  };

  const scrapeSingle = async (accountId: string): Promise<ScrapeResult | null> => {
    try {
      const res = await fetch("/api/scrape-tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok) return {
        account: accountId, error: data.error || "Erreur",
        postsFound: 0, postsNew: 0, postsDuplicate: 0, postsNotImmo: 0, postsError: 0,
        apiCalls: { rapidapi: 0, kimi: 0 }, details: [],
      };
      return data as ScrapeResult;
    } catch {
      return {
        account: accountId, error: "Erreur de connexion",
        postsFound: 0, postsNew: 0, postsDuplicate: 0, postsNotImmo: 0, postsError: 0,
        apiCalls: { rapidapi: 0, kimi: 0 }, details: [],
      };
    }
  };

  const handleScrape = async (accountId?: string) => {
    setError(""); setSuccess(""); setScrapeResults([]);

    if (accountId) {
      setScraping(accountId);
      const result = await scrapeSingle(accountId);
      if (result) {
        setScrapeResults([result]);
        if (result.error) setError(result.error);
        else setSuccess(`${result.account} : ${result.postsFound} vidéos, ${result.postsNew} annonce(s)`);
      }
      fetchAccounts();
      setScraping(null);
      return;
    }

    const active = accounts.filter(a => a.is_active);
    if (!active.length) { setError("Aucun compte TikTok actif"); return; }

    setScraping("all");
    cancelRef.current = false;
    const allResults: ScrapeResult[] = [];
    let completedCount = 0;

    for (const acc of active) {
      if (cancelRef.current) break;
      completedCount++;
      setScrapeProgress({ current: completedCount, total: active.length, name: `@${acc.tiktok_handle}` });
      setScraping(acc.id);

      const result = await scrapeSingle(acc.id);
      if (result) {
        allResults.push(result);
        setScrapeResults([...allResults]);
      }

      if (completedCount < active.length) await new Promise(r => setTimeout(r, 1500));
    }

    setScrapeResults(allResults);

    const cancelled = cancelRef.current;
    const totalNew = allResults.reduce((s, r) => s + (r.postsNew || 0), 0);
    const totalFound = allResults.reduce((s, r) => s + (r.postsFound || 0), 0);
    const errors = allResults.filter(r => r.error);
    if (errors.length > 0) setError(errors.map(r => `${r.account}: ${r.error}`).join(" | "));

    const parts = [`${allResults.length}/${active.length} comptes`, `${totalFound} vidéos`];
    if (totalNew > 0) parts.push(`${totalNew} annonce(s)`);
    setSuccess(`${cancelled ? "Collecte arrêtée" : "Collecte terminée"} ! ${parts.join(", ")}.`);

    fetchAccounts();
    setScraping(null);
    setScrapeProgress(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">TikTok</h1>
          <p className="text-muted-foreground mt-1">Scrapez les vidéos immobilières de comptes TikTok</p>
        </div>
        <div className="flex gap-2">
          {scraping && (
            <Button variant="destructive" onClick={() => { cancelRef.current = true; }}>
              <Square className="h-4 w-4 mr-2" /> Arrêter
            </Button>
          )}
          <Button onClick={() => handleScrape()} disabled={!!scraping}>
            {scraping ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Collecte...</>
            ) : (
              <><Play className="h-4 w-4 mr-2" /> Collecter tout</>
            )}
          </Button>
        </div>
      </div>

      {/* Progress */}
      {scrapeProgress && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{scrapeProgress.current}/{scrapeProgress.total} : {scrapeProgress.name}</span>
              <span className="text-sm text-muted-foreground">{Math.round((scrapeProgress.current / scrapeProgress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${((scrapeProgress.current - 0.5) / scrapeProgress.total) * 100}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /><span>{success}</span></div>}

      {/* Scrape results */}
      {scrapeResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Détails de la collecte</CardTitle>
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          {showDetails && (
            <CardContent>
              {scrapeResults.map((result, ri) => (
                <div key={ri} className="space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{result.account}</p>
                    <span className="text-xs text-muted-foreground">
                      {result.postsFound} vidéos | API: {result.apiCalls?.rapidapi}R {result.apiCalls?.kimi}K
                    </span>
                  </div>
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
                          {detail.type ? <span className="text-foreground shrink-0">{detail.type}</span> : null}
                          {detail.prix ? <span className="text-primary shrink-0">{detail.prix.toLocaleString()} FCFA</span> : null}
                          {detail.error ? <span className="text-destructive shrink-0">{detail.error.substring(0, 50)}</span> : null}
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

      {/* Add form */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Ajouter un compte TikTok</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="https://tiktok.com/@agent_immo ou @agent_immo"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="flex-1"
              required
            />
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Accounts list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !accounts.length ? (
        <Card><CardContent className="p-12 text-center">
          <Video className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucun compte TikTok ajouté.</p>
          <p className="text-muted-foreground text-sm mt-1">Ajoutez l&apos;URL d&apos;un compte TikTok d&apos;agent immobilier.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc) => (
            <Card key={acc.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="font-medium truncate">@{acc.tiktok_handle}</p>
                    <Badge variant={acc.is_active ? "default" : "secondary"} className="shrink-0">
                      {acc.is_active ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {acc.posts_found} vidéos | {acc.annonces_created} annonces | Dernière collecte : {acc.last_scraped_at ? formatDate(acc.last_scraped_at) : "Jamais"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleToggle(acc.id, acc.is_active)}>
                    {acc.is_active ? "Désactiver" : "Activer"}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleScrape(acc.id)} disabled={!!scraping}>
                    {scraping === acc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)} className="text-destructive hover:text-destructive">
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
