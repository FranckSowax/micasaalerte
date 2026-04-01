"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, Loader2, Copy, CheckCircle2, AlertCircle,
  UserCircle, Phone, X, Link as LinkIcon,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { ClientDemand } from "@/types/database";

const TYPE_OFFRE_OPTIONS = ["location", "vente", "colocation"];
const TYPE_BIEN_OPTIONS = ["appartement", "maison", "studio", "villa", "chambre", "terrain"];

export default function ClientsPage() {
  const [demands, setDemands] = useState<ClientDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [userId, setUserId] = useState("");
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    client_name: "",
    client_phone: "",
    filter_type_offre: [] as string[],
    filter_type_bien: [] as string[],
    filter_prix_min: "",
    filter_prix_max: "",
    filter_nb_chambres_min: "",
    filter_quartiers: "",
    filter_ville: "Libreville",
    exigences: "",
  });
  const supabase = createClient();

  const fetchDemands = async () => {
    const { data } = await supabase
      .from("client_demands")
      .select("*")
      .order("created_at", { ascending: false });
    setDemands((data || []) as unknown as ClientDemand[]);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      fetchDemands();
    };
    init();
  }, []);

  const formLink = typeof window !== "undefined"
    ? `${window.location.origin}/demande/${userId}`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(formLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setAdding(true);

    const res = await fetch("/api/demands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: form.client_name,
        client_phone: form.client_phone,
        filter_type_offre: form.filter_type_offre,
        filter_type_bien: form.filter_type_bien,
        filter_prix_min: form.filter_prix_min ? Number(form.filter_prix_min) : null,
        filter_prix_max: form.filter_prix_max ? Number(form.filter_prix_max) : null,
        filter_nb_chambres_min: form.filter_nb_chambres_min ? Number(form.filter_nb_chambres_min) : null,
        filter_quartiers: form.filter_quartiers ? form.filter_quartiers.split(",").map(q => q.trim()) : [],
        filter_ville: form.filter_ville,
        exigences: form.exigences || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      setShowForm(false);
      setForm({ client_name: "", client_phone: "", filter_type_offre: [], filter_type_bien: [], filter_prix_min: "", filter_prix_max: "", filter_nb_chambres_min: "", filter_quartiers: "", filter_ville: "Libreville", exigences: "" });
      setSuccess("Client ajouté !");
      fetchDemands();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce client ?")) return;
    await fetch(`/api/demands/${id}`, { method: "DELETE" });
    fetchDemands();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch(`/api/demands/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !isActive }),
    });
    fetchDemands();
  };

  const toggleFilter = (key: "filter_type_offre" | "filter_type_bien", value: string) => {
    setForm(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }));
  };

  const sourceLabels: Record<string, { label: string; color: string }> = {
    chatbot: { label: "WhatsApp", color: "bg-green-500/20 text-green-400" },
    form: { label: "Formulaire", color: "bg-blue-500/20 text-blue-400" },
    admin: { label: "Manuel", color: "bg-purple-500/20 text-purple-400" },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clients</h1>
          <p className="text-muted-foreground mt-1">{demands.length} demande{demands.length !== 1 ? "s" : ""} enregistrée{demands.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyLink}>
            {copied ? <CheckCircle2 className="h-4 w-4 mr-1.5 text-green-400" /> : <LinkIcon className="h-4 w-4 mr-1.5" />}
            {copied ? "Copié !" : "Lien formulaire"}
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            {showForm ? "Annuler" : "Ajouter"}
          </Button>
        </div>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />{success}</div>}

      {/* Share link */}
      {formLink && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground mb-2">Partagez ce lien pour que vos clients remplissent leurs critères :</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-background p-2 rounded text-xs text-primary truncate">{formLink}</code>
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Ajouter un client</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-sm font-medium">Nom</label><Input placeholder="Jean Dupont" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} required /></div>
                <div><label className="text-sm font-medium">WhatsApp</label><Input placeholder="+24177123456" value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })} required /></div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Type d&apos;offre</label>
                <div className="flex gap-2">{TYPE_OFFRE_OPTIONS.map(o => <Badge key={o} variant={form.filter_type_offre.includes(o) ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleFilter("filter_type_offre", o)}>{o}</Badge>)}</div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Type de bien</label>
                <div className="flex flex-wrap gap-2">{TYPE_BIEN_OPTIONS.map(b => <Badge key={b} variant={form.filter_type_bien.includes(b) ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => toggleFilter("filter_type_bien", b)}>{b}</Badge>)}</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label className="text-sm font-medium">Prix min</label><Input type="number" placeholder="50000" value={form.filter_prix_min} onChange={e => setForm({ ...form, filter_prix_min: e.target.value })} /></div>
                <div><label className="text-sm font-medium">Prix max</label><Input type="number" placeholder="300000" value={form.filter_prix_max} onChange={e => setForm({ ...form, filter_prix_max: e.target.value })} /></div>
                <div><label className="text-sm font-medium">Chambres min</label><Input type="number" placeholder="2" value={form.filter_nb_chambres_min} onChange={e => setForm({ ...form, filter_nb_chambres_min: e.target.value })} /></div>
                <div><label className="text-sm font-medium">Quartiers</label><Input placeholder="Angondjé, Okala" value={form.filter_quartiers} onChange={e => setForm({ ...form, filter_quartiers: e.target.value })} /></div>
              </div>
              <div><label className="text-sm font-medium">Exigences</label><Input placeholder="meublé, climatisé..." value={form.exigences} onChange={e => setForm({ ...form, exigences: e.target.value })} /></div>
              <Button type="submit" disabled={adding}>{adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}Ajouter</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Demands list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !demands.length ? (
        <Card><CardContent className="p-12 text-center">
          <UserCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucun client enregistré. Partagez le lien du formulaire ou ajoutez manuellement.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {demands.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-medium">{d.client_name || "Sans nom"}</p>
                      <Badge variant={d.is_active ? "default" : "secondary"}>{d.is_active ? "Actif" : "Inactif"}</Badge>
                      <Badge className={sourceLabels[d.source]?.color || ""}>{sourceLabels[d.source]?.label || d.source}</Badge>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
                      <Phone className="h-3.5 w-3.5" />
                      <span>{d.client_phone}</span>
                      <span className="mx-1">|</span>
                      <span>Inscrit {formatDate(d.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {d.filter_type_offre?.map(o => <Badge key={o} variant="outline" className="text-xs capitalize">{o}</Badge>)}
                      {d.filter_type_bien?.map(b => <Badge key={b} variant="secondary" className="text-xs capitalize">{b}</Badge>)}
                      {d.filter_prix_max && <Badge variant="outline" className="text-xs">max {d.filter_prix_max?.toLocaleString()} FCFA</Badge>}
                      {d.filter_nb_chambres_min && <Badge variant="outline" className="text-xs">{d.filter_nb_chambres_min}+ ch.</Badge>}
                      {d.filter_quartiers?.map(q => <Badge key={q} variant="outline" className="text-xs">{q}</Badge>)}
                      {d.exigences && <Badge variant="outline" className="text-xs">{d.exigences}</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(d.id, d.is_active)}>
                      {d.is_active ? "Désactiver" : "Activer"}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
