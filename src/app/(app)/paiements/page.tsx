"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Copy, Loader2, Wallet, X } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface PaymentRow {
  id: string;
  demand_id: string;
  reference: string | null;
  amount: number | null;
  days: number | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  confirmed_at: string | null;
}

interface ClientRow {
  id: string;
  client_name: string | null;
  client_phone: string;
}

const STATUS = {
  pending: { label: "À vérifier", className: "bg-amber-500/20 text-amber-400" },
  confirmed: { label: "Validé", className: "bg-green-500/20 text-green-400" },
  rejected: { label: "Refusé", className: "bg-red-500/20 text-red-400" },
};

/**
 * Paiements déclarés par les abonnés. L'agent retrouve la référence dans son relevé Airtel Money,
 * puis valide : l'abonnement démarre et l'abonné reçoit sa première sélection sur WhatsApp.
 */
export default function PaiementsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [clients, setClients] = useState<Map<string, ClientRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [missingTable, setMissingTable] = useState(false);
  const supabase = createClient();

  const load = useCallback(async () => {
    const { data, error: paymentsError } = await supabase
      .from("subscription_payments")
      .select("id, demand_id, reference, amount, days, status, created_at, confirmed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    // Table absente tant que le script SQL n'a pas été relancé.
    setMissingTable(!!paymentsError);
    const rows = (data || []) as unknown as PaymentRow[];
    setPayments(rows);

    const ids = Array.from(new Set(rows.map((p) => p.demand_id)));
    if (ids.length) {
      const { data: demandRows } = await supabase.from("client_demands").select("id, client_name, client_phone").in("id", ids);
      setClients(new Map(((demandRows || []) as unknown as ClientRow[]).map((c) => [c.id, c])));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (payment: PaymentRow, action: "activate" | "reject") => {
    const who = clients.get(payment.demand_id);
    const name = who?.client_name || who?.client_phone || "cet abonné";
    const question =
      action === "activate"
        ? `Avez-vous bien reçu ${payment.amount?.toLocaleString("fr-FR") ?? "?"} FCFA avec la référence ${payment.reference} ?\n\nL'abonnement de ${name} démarre et il reçoit sa première sélection sur WhatsApp.`
        : `Refuser la déclaration de ${name} (référence ${payment.reference}) ?`;
    if (!confirm(question)) return;

    setError(""); setSuccess(""); setBusy(payment.id);
    try {
      const res = await fetch(`/api/demands/${payment.demand_id}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Action impossible");
      } else if (action === "reject") {
        setSuccess("Déclaration refusée.");
      } else {
        const added = typeof data.added === "number" ? data.added : 0;
        const selection = added ? ` avec ${added} annonce${added > 1 ? "s" : ""}` : "";
        setSuccess(data.notified ? `Abonnement activé. ${name} a reçu le message WhatsApp${selection}.` : `Abonnement activé, mais le message WhatsApp n'a pas pu partir. ${added ? `${added} annonce(s) ajoutée(s) à son espace.` : ""}`);
      }
      await load();
    } catch {
      setError("Connexion impossible. Réessayez.");
    }
    setBusy(null);
  };

  const copy = async (reference: string) => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(reference);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Presse-papiers refusé : la référence reste lisible à l'écran.
    }
  };

  const pending = payments.filter((p) => p.status === "pending");
  const processed = payments.filter((p) => p.status !== "pending").slice(0, 30);

  const row = (p: PaymentRow) => {
    const who = clients.get(p.demand_id);
    return (
      <Card key={p.id} className={p.status === "pending" ? "border-amber-500/60" : ""}>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={STATUS[p.status].className}>{STATUS[p.status].label}</Badge>
              <span className="font-medium">{who?.client_name || "Abonné sans nom"}</span>
              <span className="text-sm text-muted-foreground">{who?.client_phone}</span>
            </div>
            <p className="text-sm">
              <span className="font-bold">{p.amount?.toLocaleString("fr-FR") ?? "?"} FCFA</span> pour {p.days ?? "?"} jour{(p.days ?? 0) > 1 ? "s" : ""} · référence{" "}
              <span className="font-mono font-bold text-base">{p.reference || "non fournie"}</span>
              {p.reference && (
                <button type="button" className="ml-2 inline-flex items-center text-xs text-primary hover:underline" onClick={() => copy(p.reference as string)}>
                  <Copy className="h-3 w-3 mr-1" />{copied === p.reference ? "Copiée" : "Copier"}
                </button>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Déclaré le {formatDate(p.created_at)}
              {p.confirmed_at ? ` · traité le ${formatDate(p.confirmed_at)}` : ""}
            </p>
          </div>
          {p.status === "pending" && (
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy === p.id} onClick={() => act(p, "activate")}>
                {busy === p.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Valider le paiement
              </Button>
              <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => act(p, "reject")}>
                <X className="h-4 w-4 mr-1" /> Refuser
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Paiements</h1>
        <p className="text-muted-foreground mt-1">
          Les abonnés déclarent leur paiement Airtel Money avec une référence de commande. Retrouvez cette référence dans votre relevé marchand, puis validez : l&apos;abonnement démarre et l&apos;abonné reçoit sur WhatsApp la confirmation avec sa première sélection d&apos;annonces.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{error}</div>}
      {success && <div className="p-3 rounded-md bg-green-500/10 text-green-400 text-sm flex items-start gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />{success}</div>}
      {missingTable && <div className="p-3 rounded-md bg-amber-500/10 text-amber-400 text-sm">La table des paiements est absente : relancez supabase_schema.sql dans Supabase.</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">À vérifier ({pending.length})</h2>
            {pending.length ? pending.map(row) : (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Wallet className="h-10 w-10 mx-auto mb-2" />Aucun paiement en attente.
              </CardContent></Card>
            )}
          </section>
          {!!processed.length && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Derniers paiements traités</h2>
              {processed.map(row)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
