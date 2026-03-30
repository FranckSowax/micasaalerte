"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Send, Loader2, X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { WhatsAppChannel, WhatsAppLog } from "@/types/database";

const TYPE_OFFRE_OPTIONS = ["location", "vente", "colocation", "sous-location", "recherche"];
const TYPE_BIEN_OPTIONS = ["appartement", "maison", "studio", "chambre", "terrain", "bureau", "villa"];

export default function WhatsAppPage() {
  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [logs, setLogs] = useState<WhatsAppLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone_number: "",
    channel_type: "individual" as "individual" | "group",
    filter_type_offre: [] as string[],
    filter_type_bien: [] as string[],
    filter_prix_min: "",
    filter_prix_max: "",
    filter_quartiers: "",
    filter_ville: "",
  });
  const supabase = createClient();

  const fetchData = async () => {
    const [channelsRes, logsRes] = await Promise.all([
      supabase.from("whatsapp_channels").select("*").order("created_at", { ascending: false }),
      supabase.from("whatsapp_logs").select("*").order("sent_at", { ascending: false }).limit(20),
    ]);
    setChannels(channelsRes.data || []);
    setLogs(logsRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const { error: insertError } = await supabase.from("whatsapp_channels").insert({
      user_id: (await supabase.auth.getUser()).data.user!.id,
      name: form.name,
      phone_number: form.phone_number,
      channel_type: form.channel_type,
      filter_type_offre: form.filter_type_offre,
      filter_type_bien: form.filter_type_bien,
      filter_prix_min: form.filter_prix_min ? Number(form.filter_prix_min) : null,
      filter_prix_max: form.filter_prix_max ? Number(form.filter_prix_max) : null,
      filter_quartiers: form.filter_quartiers ? form.filter_quartiers.split(",").map((q) => q.trim()) : [],
      filter_ville: form.filter_ville || null,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setShowForm(false);
      setForm({
        name: "", phone_number: "", channel_type: "individual",
        filter_type_offre: [], filter_type_bien: [],
        filter_prix_min: "", filter_prix_max: "", filter_quartiers: "", filter_ville: "",
      });
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce canal ?")) return;
    await supabase.from("whatsapp_channels").delete().eq("id", id);
    fetchData();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from("whatsapp_channels").update({ is_active: !isActive }).eq("id", id);
    fetchData();
  };

  const handleBroadcast = async () => {
    setBroadcasting(true);
    setSuccess("");
    setError("");
    try {
      const res = await fetch("/api/whatsapp/broadcast", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`${data.totalSent || 0} annonce(s) envoyée(s) avec succès`);
        fetchData();
      } else {
        setError(data.error || "Erreur lors de la diffusion");
      }
    } catch {
      setError("Erreur de connexion");
    }
    setBroadcasting(false);
  };

  const toggleFilter = (key: "filter_type_offre" | "filter_type_bien", value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">WhatsApp</h1>
          <p className="text-muted-foreground mt-1">Gérez vos canaux de diffusion</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowForm(!showForm)}>
            {showForm ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {showForm ? "Annuler" : "Nouveau canal"}
          </Button>
          <Button onClick={handleBroadcast} disabled={broadcasting}>
            {broadcasting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Diffuser
          </Button>
        </div>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm">{success}</div>}

      {/* Create channel form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Nouveau canal</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nom</label>
                  <Input placeholder="Clients VIP" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Numéro WhatsApp</label>
                  <Input placeholder="+24177123456" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Type</label>
                  <select value={form.channel_type} onChange={(e) => setForm({ ...form, channel_type: e.target.value as "individual" | "group" })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="individual">Individuel</option>
                    <option value="group">Groupe</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Filtrer par type d&apos;offre</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_OFFRE_OPTIONS.map((o) => (
                    <Badge key={o} variant={form.filter_type_offre.includes(o) ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleFilter("filter_type_offre", o)}>
                      {o}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Filtrer par type de bien</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_BIEN_OPTIONS.map((b) => (
                    <Badge key={b} variant={form.filter_type_bien.includes(b) ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleFilter("filter_type_bien", b)}>
                      {b}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Prix min</label>
                  <Input type="number" placeholder="50000" value={form.filter_prix_min} onChange={(e) => setForm({ ...form, filter_prix_min: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Prix max</label>
                  <Input type="number" placeholder="500000" value={form.filter_prix_max} onChange={(e) => setForm({ ...form, filter_prix_max: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Quartiers (virgule)</label>
                  <Input placeholder="Angondjé, Okala" value={form.filter_quartiers} onChange={(e) => setForm({ ...form, filter_quartiers: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Ville</label>
                  <Input placeholder="Libreville" value={form.filter_ville} onChange={(e) => setForm({ ...form, filter_ville: e.target.value })} />
                </div>
              </div>

              <Button type="submit">Créer le canal</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Channels list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !channels.length ? (
        <Card><CardContent className="p-12 text-center"><p className="text-muted-foreground">Aucun canal WhatsApp configuré.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <Card key={ch.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium">{ch.name}</p>
                      <Badge variant={ch.is_active ? "default" : "secondary"}>{ch.is_active ? "Actif" : "Inactif"}</Badge>
                      <Badge variant="outline">{ch.channel_type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{ch.phone_number}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {ch.filter_type_offre?.map((f) => <Badge key={f} variant="outline" className="text-xs capitalize">{f}</Badge>)}
                      {ch.filter_type_bien?.map((f) => <Badge key={f} variant="secondary" className="text-xs capitalize">{f}</Badge>)}
                      {ch.filter_prix_min && <Badge variant="outline" className="text-xs">Min: {ch.filter_prix_min} FCFA</Badge>}
                      {ch.filter_prix_max && <Badge variant="outline" className="text-xs">Max: {ch.filter_prix_max} FCFA</Badge>}
                      {ch.filter_quartiers?.map((q) => <Badge key={q} variant="outline" className="text-xs">{q}</Badge>)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(ch.id, ch.is_active)}>{ch.is_active ? "Désactiver" : "Activer"}</Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(ch.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recent logs */}
      {logs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Envois récents</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-2 rounded bg-background text-sm">
                  <span className="text-muted-foreground">{log.phone_number}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={log.status === "sent" || log.status === "delivered" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                      {log.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(log.sent_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
