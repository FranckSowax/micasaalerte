import Link from "next/link";
import { BadgeDollarSign, Clock, Repeat, ShoppingBag, Target, UserCheck, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessKpis, trend, type DemandRow, type PaymentRow } from "@/lib/business-kpis";
import { createServiceClient } from "@/lib/supabase/server";

// Section « Abonnés et chiffre d'affaires » du tableau de bord (composant serveur).
// Lecture avec la clé service, filtrée sur l'agent connecté : mêmes données que ses écrans Clients et Paiements.

export const PERIODS = [7, 30, 90] as const;

const SOURCE_LABEL: Record<string, string> = { form: "Formulaire", chatbot: "WhatsApp", admin: "Ajout manuel" };

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)} %`);

async function readAll<T>(table: string, columns: string, userId: string): Promise<{ rows: T[]; error: boolean }> {
  const service = createServiceClient();
  const rows: T[] = [];
  // Supabase renvoie 1 000 lignes au plus par requête.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await service
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) return { rows, error: true };
    rows.push(...((data || []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: false };
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const t = trend(current, previous);
  if (t === null) return <span className="text-xs text-muted-foreground">{current ? "pas de comparaison" : " "}</span>;
  const color = t > 0 ? "text-green-500" : t < 0 ? "text-red-500" : "text-muted-foreground";
  return (
    <span className={`text-xs ${color}`}>
      {t > 0 ? "+" : ""}
      {t} % vs période préc.
    </span>
  );
}

export async function BusinessSection({ userId, period }: { userId: string; period: number }) {
  const [demands, payments] = await Promise.all([
    readAll<DemandRow>("client_demands", "id, client_phone, source, created_at, trial_ends_at, paid_until", userId),
    readAll<PaymentRow>("subscription_payments", "demand_id, amount, days, status, created_at, confirmed_at", userId),
  ]);

  if (demands.error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Indicateurs d&apos;abonnement indisponibles : la base ne répond pas ou le script SQL n&apos;a pas été exécuté.
        </CardContent>
      </Card>
    );
  }

  const k = businessKpis(demands.rows, payments.rows, new Date(), period);
  const maxRevenue = Math.max(1, ...k.daily.map((d) => d.revenue));
  const maxSignups = Math.max(1, ...k.daily.map((d) => d.signups));
  const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  const headline = [
    { title: "Inscriptions gratuites", value: k.current.signups.toLocaleString("fr-FR"), prev: k.previous.signups, cur: k.current.signups, icon: UserPlus, color: "text-sky-400" },
    { title: "Nouveaux abonnés payants", value: k.current.newSubscribers.toLocaleString("fr-FR"), prev: k.previous.newSubscribers, cur: k.current.newSubscribers, icon: UserCheck, color: "text-green-400" },
    { title: "Chiffre d'affaires", value: fcfa(k.current.revenue), prev: k.previous.revenue, cur: k.current.revenue, icon: BadgeDollarSign, color: "text-amber-400" },
    { title: "Paiements validés", value: k.current.payments.toLocaleString("fr-FR"), prev: k.previous.payments, cur: k.current.payments, icon: ShoppingBag, color: "text-purple-400" },
  ];

  const secondary = [
    { title: "Abonnés actifs (payants)", value: k.status.active, hint: `${k.status.trial} en essai · ${k.status.expired} expirés`, icon: Users },
    { title: "Taux de conversion", value: pct(k.conversionRate), hint: "inscrits ayant payé, essai terminé", icon: Target },
    { title: "Taux de réabonnement", value: pct(k.renewalRate), hint: "payants ayant payé 2 fois ou plus", icon: Repeat },
    { title: "Panier moyen", value: k.averageBasket === null ? "—" : fcfa(k.averageBasket), hint: "par paiement validé", icon: ShoppingBag },
  ];

  const sources = Object.entries(k.sources).sort((a, b) => b[1] - a[1]);
  const totalSignups = sources.reduce((s, [, n]) => s + n, 0) || 1;
  const totalPlans = k.plans.day + k.plans.week + k.plans.month + k.plans.other || 1;

  return (
    <section className="space-y-4" aria-labelledby="business-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="business-title" className="text-xl font-semibold">Abonnés et chiffre d&apos;affaires</h2>
          <p className="text-sm text-muted-foreground">
            {period} derniers jours, comparés aux {period} jours précédents. Les accès illimités (démo, équipe) sont exclus.
          </p>
        </div>
        <nav className="flex gap-1 rounded-md border border-border p-1" aria-label="Période">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/dashboard?periode=${p}`}
              className={`rounded px-3 py-1 text-sm ${p === period ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              aria-current={p === period ? "page" : undefined}
            >
              {p} j
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {headline.map((kpi) => (
          <Card key={kpi.title}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{kpi.title}</p>
                  <p className="text-2xl font-bold mt-1 tabular-nums">{kpi.value}</p>
                  <Trend current={kpi.cur} previous={kpi.prev} />
                </div>
                <kpi.icon className={`h-9 w-9 shrink-0 ${kpi.color} opacity-80`} aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {secondary.map((kpi) => (
          <Card key={kpi.title}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <kpi.icon className="h-4 w-4" aria-hidden="true" /> {kpi.title}
              </div>
              <p className="text-2xl font-bold mt-1 tabular-nums">{kpi.value}</p>
              <p className="text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Jour par jour</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Chiffre d&apos;affaires encaissé</p>
              <div className="flex h-24 items-end gap-px" role="img" aria-label={`Chiffre d'affaires par jour sur ${period} jours`}>
                {k.daily.map((d) => (
                  <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${dayLabel(d.day)} : ${fcfa(d.revenue)}`}>
                    <div className="w-full rounded-t-sm bg-amber-500" style={{ height: `${d.revenue ? Math.max(3, (d.revenue / maxRevenue) * 100) : 0}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Inscriptions gratuites</p>
              <div className="flex h-16 items-end gap-px" role="img" aria-label={`Inscriptions par jour sur ${period} jours`}>
                {k.daily.map((d) => (
                  <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${dayLabel(d.day)} : ${d.signups} inscription(s)`}>
                    <div className="w-full rounded-t-sm bg-sky-500" style={{ height: `${d.signups ? Math.max(4, (d.signups / maxSignups) * 100) : 0}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{dayLabel(k.daily[0].day)}</span>
              <span>aujourd&apos;hui</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Encaissements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Ce mois-ci</span><span className="font-semibold tabular-nums">{fcfa(k.monthRevenue)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Depuis le début</span><span className="font-semibold tabular-nums">{fcfa(k.allTimeRevenue)}</span></div>
            <Link href="/paiements" className="flex items-center justify-between rounded-md bg-amber-500/10 p-2 hover:bg-amber-500/20">
              <span className="flex items-center gap-1.5 text-amber-500"><Clock className="h-4 w-4" aria-hidden="true" /> À valider</span>
              <span className="font-semibold tabular-nums">{k.pending.count} · {fcfa(k.pending.amount)}</span>
            </Link>
            <div className="border-t border-border pt-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">Formules vendues (tous paiements validés)</p>
              {([["day", "1 jour"], ["week", "7 jours"], ["month", "30 jours"], ["other", "Autre"]] as const)
                .filter(([key]) => key !== "other" || k.plans.other > 0)
                .map(([key, label]) => (
                  <div key={key} className="flex justify-between">
                    <span>{label}</span>
                    <span className="tabular-nums">{k.plans[key]} ({Math.round((k.plans[key] / totalPlans) * 100)} %)</span>
                  </div>
                ))}
            </div>
            <div className="border-t border-border pt-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">Origine des inscriptions (total)</p>
              {sources.length === 0 && <p className="text-muted-foreground">Aucune inscription.</p>}
              {sources.map(([key, n]) => (
                <div key={key} className="flex justify-between">
                  <span>{SOURCE_LABEL[key] ?? key}</span>
                  <span className="tabular-nums">{n} ({Math.round((n / totalSignups) * 100)} %)</span>
                </div>
              ))}
            </div>
            {payments.error && <p className="text-xs text-destructive">Paiements illisibles : relancez le script SQL (table subscription_payments).</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
