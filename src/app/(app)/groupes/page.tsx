"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Play, Loader2, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { FacebookGroup } from "@/types/database";

export default function GroupesPage() {
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [newGroupUrl, setNewGroupUrl] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const supabase = createClient();

  const fetchGroups = async () => {
    const { data } = await supabase
      .from("facebook_groups")
      .select("*")
      .order("created_at", { ascending: false });
    setGroups((data || []) as unknown as FacebookGroup[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const extractGroupId = (url: string): string | null => {
    const patterns = [
      /facebook\.com\/groups\/(\d+)/,
      /facebook\.com\/groups\/([^/?]+)/,
    ];
    for (const p of patterns) {
      const match = url.match(p);
      if (match) return match[1];
    }
    return null;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setAdding(true);

    const groupId = extractGroupId(newGroupUrl);
    if (!groupId) {
      setError("URL de groupe Facebook invalide. Format attendu : https://facebook.com/groups/123456");
      setAdding(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expirée. Veuillez vous reconnecter.");
      setAdding(false);
      return;
    }

    const { error: insertError } = await supabase.from("facebook_groups").insert({
      user_id: user.id,
      group_id: groupId,
      group_url: newGroupUrl,
      group_name: newGroupName || `Groupe ${groupId}`,
    });

    if (insertError) {
      setError(insertError.message.includes("duplicate")
        ? "Ce groupe est déjà ajouté"
        : insertError.message);
    } else {
      setNewGroupUrl("");
      setNewGroupName("");
      setSuccess("Groupe ajouté avec succès !");
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
    setError("");
    setSuccess("");
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
        const results = data.results || [];
        const totalNew = results.reduce((sum: number, r: Record<string, number>) => sum + (r.postsNew || 0), 0);
        const totalFound = results.reduce((sum: number, r: Record<string, number>) => sum + (r.postsFound || 0), 0);
        const errors = results.filter((r: Record<string, string>) => r.error);

        if (errors.length > 0) {
          setError(`Erreur(s) : ${errors.map((r: Record<string, string>) => `${r.group}: ${r.error}`).join(", ")}`);
        } else {
          setSuccess(`Collecte terminée ! ${totalFound} post(s) trouvé(s), ${totalNew} nouvelle(s) annonce(s) ajoutée(s).`);
        }
        fetchGroups();
      }
    } catch (err) {
      setError("Erreur de connexion au serveur");
      console.error("Scrape error:", err);
    }
    setScraping(null);
  };

  return (
    <div className="space-y-8">
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
        <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Add group form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ajouter un groupe</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Nom du groupe"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="sm:w-48"
              required
            />
            <Input
              placeholder="https://facebook.com/groups/..."
              value={newGroupUrl}
              onChange={(e) => setNewGroupUrl(e.target.value)}
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

      {/* Groups list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !groups.length ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Aucun groupe ajouté. Collez l&apos;URL d&apos;un groupe Facebook ci-dessus.</p>
          </CardContent>
        </Card>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(group.id, group.is_active)}
                  >
                    {group.is_active ? "Désactiver" : "Activer"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleScrape(group.id)}
                    disabled={!!scraping}
                  >
                    {scraping === group.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(group.id)}
                    className="text-destructive hover:text-destructive"
                  >
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
