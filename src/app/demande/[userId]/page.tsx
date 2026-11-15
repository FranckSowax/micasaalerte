"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, Loader2, CheckCircle2 } from "lucide-react";
import { CriteriaFields, criteriaPayload, EMPTY_CRITERIA, type CriteriaValue } from "@/components/criteria-form";
import { planOffer, SUBSCRIPTION_PLANS, TRIAL_HOURS } from "@/lib/subscription";

export default function DemandePage({ params }: { params: { userId: string } }) {
  const [submitted, setSubmitted] = useState<{ isNew: boolean; spacePath: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState({ client_name: "", client_phone: "" });
  const [criteria, setCriteria] = useState<CriteriaValue>(EMPTY_CRITERIA);

  const offers = SUBSCRIPTION_PLANS.map(planOffer).join(" · ");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);

    if (!identity.client_phone.match(/^\+?\d{8,15}$/)) {
      setError("Numéro WhatsApp invalide. Format : +24177123456");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/demands/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: params.userId,
          client_name: identity.client_name,
          client_phone: identity.client_phone.replace(/\s/g, ""),
          ...criteriaPayload(criteria),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de l'envoi");
      } else {
        setSubmitted({ isNew: data.isNew !== false, spacePath: data.spacePath || null });
      }
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">Demande enregistrée !</h2>
            <p className="text-muted-foreground">
              Vous recevrez les annonces correspondantes directement sur WhatsApp au numéro {identity.client_phone}.
            </p>
            {submitted.isNew ? (
              <p className="text-sm">
                Votre essai gratuit de {TRIAL_HOURS} h commence maintenant. Ensuite : {offers}.
              </p>
            ) : (
              <p className="text-sm">Vos critères sont mis à jour. Votre espace reste accessible par le lien reçu sur WhatsApp.</p>
            )}
            {submitted.spacePath && (
              <a href={submitted.spacePath} className="inline-flex items-center justify-center h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium w-full">
                Ouvrir mon espace
              </a>
            )}
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
          <p className="text-sm text-primary mt-2">
            {TRIAL_HOURS} h d&apos;essai gratuit, puis {offers}
          </p>
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
                <Input placeholder="Votre nom" value={identity.client_name} onChange={e => setIdentity({ ...identity, client_name: e.target.value })} required />
              </div>
              <div>
                <label className="text-sm font-medium">Numéro WhatsApp *</label>
                <Input placeholder="+24177123456" value={identity.client_phone} onChange={e => setIdentity({ ...identity, client_phone: e.target.value })} required />
              </div>
            </CardContent>
          </Card>

          <CriteriaFields value={criteria} onChange={setCriteria} />

          <Button type="submit" className="w-full text-lg h-12" disabled={loading}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Recevoir les annonces sur WhatsApp
          </Button>
        </form>
      </div>
    </div>
  );
}
