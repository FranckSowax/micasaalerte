import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { SUBSCRIPTION_PLANS, TRIAL_HOURS } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Brain,
  MessageSquare,
  BarChart3,
  Zap,
  ArrowRight,
  CheckCircle2,
  MapPinned,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";

const INCLUDED = [
  { icon: MessageSquare, title: "Alertes WhatsApp en temps réel", desc: "Chaque nouvelle annonce qui vous correspond arrive sur votre WhatsApp, sans application à installer." },
  { icon: Smartphone, title: "Annonces Facebook et TikTok", desc: "Groupes, pages d'agents et comptes TikTok sont surveillés en continu, même quand l'annonce est écrite sur la vidéo." },
  { icon: SlidersHorizontal, title: "Critères : quartier, budget, type", desc: "Vous fixez votre budget, vos quartiers et le type de bien : seules les annonces qui collent vous sont envoyées." },
  { icon: MapPinned, title: "Espace personnel et carte", desc: "Retrouvez vos annonces, triez-les et situez-les sur la carte, depuis votre téléphone." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandLogo className="h-10 w-auto" priority />
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Connexion</Button>
            </Link>
            <Link href="/signup">
              <Button>S&apos;inscrire</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-6xl font-bold mb-6 leading-tight">
            Ne manquez plus aucune{" "}
            <span className="text-primary">annonce immobilière</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Mi Casa Gabon surveille automatiquement les annonces sur Facebook et TikTok, analyse les annonces
            avec l&apos;IA et vous les envoie sur WhatsApp en temps réel.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" className="text-lg px-8">
                Commencer gratuitement
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Comment ça marche ?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Search,
                title: "Scraping automatique",
                desc: "Surveillez les groupes Facebook immobiliers au Gabon. Les nouvelles annonces sont collectées automatiquement.",
              },
              {
                icon: Brain,
                title: "Analyse IA intelligente",
                desc: "Claude IA extrait prix, quartier, type de bien, nombre de pièces et toutes les infos clés de chaque annonce.",
              },
              {
                icon: MessageSquare,
                title: "Alertes WhatsApp",
                desc: "Recevez les annonces qui vous intéressent directement sur WhatsApp, filtrées selon vos critères.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="bg-card border-border">
                <CardContent className="p-6 text-center">
                  <feature.icon className="h-12 w-12 text-primary mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* More features */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Tout ce dont vous avez besoin
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: "Dashboard complet", desc: "Statistiques en temps réel sur vos annonces" },
              { icon: Zap, title: "Filtres avancés", desc: "Triez par prix, quartier, type de bien et plus" },
              { icon: Search, title: "Multi-groupes", desc: "Surveillez plusieurs groupes Facebook simultanément" },
              { icon: Brain, title: "Détection intelligente", desc: "L'IA distingue les vraies annonces du bruit" },
              { icon: MessageSquare, title: "Multi-canaux", desc: "Envoyez à différents contacts avec des filtres" },
              { icon: CheckCircle2, title: "Favoris", desc: "Sauvegardez et organisez vos annonces préférées" },
            ].map((feature) => (
              <div key={feature.title} className="flex items-start gap-3 p-4">
                <feature.icon className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing — formules lues dans lib/subscription : les prix affichés sont ceux facturés. */}
      <section className="py-20 px-4 bg-card/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3">Tarifs</h2>
          <p className="text-center text-muted-foreground mb-12">
            Sans engagement : vous payez seulement la durée choisie, par Airtel Money.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-border">
              <CardContent className="p-6 flex flex-col h-full">
                <h3 className="text-lg font-bold mb-1">Essai gratuit</h3>
                <p className="text-3xl font-bold">0 FCFA</p>
                <p className="text-sm text-muted-foreground mb-4">pendant {TRIAL_HOURS} heures</p>
                <p className="text-sm text-muted-foreground mb-6 flex-1">Aucun paiement à l&apos;inscription : recevez vos premières annonces tout de suite.</p>
                <Link href="/signup">
                  <Button variant="outline" className="w-full">Essayer</Button>
                </Link>
              </CardContent>
            </Card>
            {SUBSCRIPTION_PLANS.map((plan) => {
              const highlighted = plan.id === "week";
              const perDay = Math.round(plan.price / plan.days);
              return (
                <Card key={plan.id} className={highlighted ? "border-primary relative" : "border-border"}>
                  {highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                      Le plus choisi
                    </span>
                  )}
                  <CardContent className="p-6 flex flex-col h-full">
                    <h3 className={`text-lg font-bold mb-1 ${highlighted ? "text-primary" : ""}`}>{plan.label}</h3>
                    <p className="text-3xl font-bold">{new Intl.NumberFormat("fr-FR").format(plan.price)} FCFA</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      {plan.note ? plan.note : `soit ${new Intl.NumberFormat("fr-FR").format(perDay)} FCFA par jour`}
                    </p>
                    <div className="flex-1" />
                    <Link href="/signup">
                      <Button variant={highlighted ? "default" : "outline"} className="w-full">Commencer</Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Inclus dans toutes les formules. */}
          <h3 className="text-xl font-bold text-center mt-16 mb-8">Inclus dans toutes les formules</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {INCLUDED.map((f) => (
              <Card key={f.title} className="border-border">
                <CardContent className="p-6">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <f.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  </div>
                  <h4 className="font-semibold mb-1">{f.title}</h4>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Prêt à ne plus rater d&apos;annonces ?
          </h2>
          <p className="text-muted-foreground mb-8">
            Rejoignez Mi Casa Gabon et trouvez votre prochain bien immobilier avant tout le monde.
          </p>
          <Link href="/signup">
            <Button size="lg" className="text-lg px-8">
              Créer mon compte
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandLogo className="h-7 w-auto" />
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Mi Casa Gabon. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
