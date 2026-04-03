"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Home, Loader2, CheckCircle2, MapPin, X } from "lucide-react";

const TYPE_OFFRE = ["location", "vente", "colocation"];
const TYPE_BIEN = ["appartement", "maison", "studio", "villa", "chambre", "terrain"];
const MAX_QUARTIERS = 3;

export default function DemandePage({ params }: { params: { userId: string } }) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quartiersOptions, setQuartiersOptions] = useState<{ name: string; count: number }[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    client_name: "",
    client_phone: "",
    type_offre: [] as string[],
    type_bien: [] as string[],
    prix_min: "",
    prix_max: "",
    nb_chambres_min: "",
    quartiers: [] as string[],
    ville: "Libreville",
    exigences: "",
  });

  useEffect(() => {
    fetch(`/api/quartiers?userId=${params.userId}`)
      .then(r => r.json())
      .then(data => setQuartiersOptions(data))
      .catch(() => {});
  }, [params.userId]);

  const toggleArray = (key: "type_offre" | "type_bien" | "quartiers", value: string) => {
    setForm(prev => {
      const current = prev[key];
      if (current.includes(value)) {
        return { ...prev, [key]: current.filter(v => v !== value) };
      }
      // Max 3 quartiers
      if (key === "quartiers" && current.length >= MAX_QUARTIERS) return prev;
      return { ...prev, [key]: [...current, value] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);

    if (!form.client_phone.match(/^\+?\d{8,15}$/)) {
      setError("Numéro WhatsApp invalide. Format : +24177123456");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/demands/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        client_name: form.client_name,
        client_phone: form.client_phone.replace(/\s/g, ""),
        filter_type_offre: form.type_offre,
        filter_type_bien: form.type_bien,
        filter_prix_min: form.prix_min ? Number(form.prix_min) : null,
        filter_prix_max: form.prix_max ? Number(form.prix_max) : null,
        filter_nb_chambres_min: form.nb_chambres_min ? Number(form.nb_chambres_min) : null,
        filter_quartiers: form.quartiers,
        filter_ville: form.ville,
        exigences: form.exigences || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Erreur lors de l'envoi");
    } else {
      setSubmitted(true);
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Demande enregistrée !</h2>
            <p className="text-muted-foreground">
              Vous recevrez les annonces correspondantes directement sur WhatsApp au numéro {form.client_phone}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Home className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">Mi Casa Alerte</span>
          </div>
          <h1 className="text-xl font-bold">Trouvez votre bien idéal</h1>
          <p className="text-muted-foreground mt-1">Remplissez vos critères et recevez les annonces sur WhatsApp</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          {/* Infos personnelles */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Vos informations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nom *</label>
                <Input placeholder="Votre nom" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} required />
              </div>
              <div>
                <label className="text-sm font-medium">Numéro WhatsApp *</label>
                <Input placeholder="+24177123456" value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })} required />
              </div>
            </CardContent>
          </Card>

          {/* Type offre */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Type de recherche</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Vous cherchez à :</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_OFFRE.map(o => (
                    <Badge key={o} variant={form.type_offre.includes(o) ? "default" : "outline"}
                      className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggleArray("type_offre", o)}>
                      {o}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Type de bien :</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_BIEN.map(b => (
                    <Badge key={b} variant={form.type_bien.includes(b) ? "default" : "outline"}
                      className="cursor-pointer capitalize text-sm py-1.5 px-3" onClick={() => toggleArray("type_bien", b)}>
                      {b}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Budget + chambres */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Budget et taille</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Budget min (FCFA)</label>
                  <Input type="number" placeholder="50000" value={form.prix_min} onChange={e => setForm({ ...form, prix_min: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Budget max (FCFA)</label>
                  <Input type="number" placeholder="300000" value={form.prix_max} onChange={e => setForm({ ...form, prix_max: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Chambres minimum</label>
                <select value={form.nb_chambres_min} onChange={e => setForm({ ...form, nb_chambres_min: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Pas de minimum</option>
                  <option value="1">1+</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                  <option value="5">5+</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Quartiers */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Quartiers</CardTitle>
              </div>
              <CardDescription>
                Sélectionnez jusqu&apos;à {MAX_QUARTIERS} quartiers ({form.quartiers.length}/{MAX_QUARTIERS})
                {form.quartiers.length === 0 && " - ou laissez vide pour tous"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {quartiersOptions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {quartiersOptions.map(q => {
                    const selected = form.quartiers.includes(q.name);
                    const disabled = !selected && form.quartiers.length >= MAX_QUARTIERS;
                    return (
                      <Badge
                        key={q.name}
                        variant={selected ? "default" : "outline"}
                        className={`text-sm py-1.5 px-3 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                        onClick={() => !disabled && toggleArray("quartiers", q.name)}
                      >
                        {q.name}
                        <span className="ml-1 text-[10px] opacity-60">({q.count})</span>
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Chargement des quartiers...</p>
              )}
              {form.quartiers.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">Sélectionnés :</p>
                  <div className="flex gap-2">
                    {form.quartiers.map(q => (
                      <Badge key={q} className="cursor-pointer" onClick={() => toggleArray("quartiers", q)}>
                        {q} <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Exigences */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Exigences particulières</CardTitle></CardHeader>
            <CardContent>
              <textarea
                placeholder="Meublé, climatisé, parking, gardien, eau chaude..."
                value={form.exigences}
                onChange={e => setForm({ ...form, exigences: e.target.value })}
                className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </CardContent>
          </Card>

          <Button type="submit" className="w-full text-lg h-12" disabled={loading}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Recevoir les annonces sur WhatsApp
          </Button>
        </form>
      </div>
    </div>
  );
}
