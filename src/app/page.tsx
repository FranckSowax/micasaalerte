import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Reveal } from "@/components/reveal";
import { SUBSCRIPTION_PLANS, TRIAL_HOURS } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Brain,
  MessageSquare,
  ArrowRight,
  MapPinned,
  Copy,
  Clock,
  Sparkles,
  Phone,
  Image as ImageIcon,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";

const STEPS = [
  { icon: SlidersHorizontal, title: "Vous fixez vos critères", desc: "Budget, quartiers ou rayon autour d'un point, type de bien, nombre de chambres : votre recherche en une minute." },
  { icon: Search, title: "Nous surveillons pour vous", desc: "Groupes Facebook, pages d'agents et comptes TikTok sont lus en continu ; l'IA comprend chaque annonce, même écrite sur la vidéo." },
  { icon: MessageSquare, title: "Les annonces arrivent sur WhatsApp", desc: "Dès qu'une annonce correspond, vous êtes prévenu sur WhatsApp et la retrouvez dans votre espace, avec photos et carte." },
];

const BENEFITS = [
  { icon: Brain, title: "Uniquement de vraies offres", desc: "L'IA écarte les recherches de logement, la publicité et les biens hors du Gabon : vous ne recevez que des annonces à louer ou à vendre." },
  { icon: Copy, title: "Zéro doublon", desc: "Une même annonce republiée dix fois, ou relayée par plusieurs agents, ne vous arrive qu'une seule fois." },
  { icon: Clock, title: "Des annonces fraîches", desc: "Au-delà de 60 heures, une annonce est retirée : fini les biens déjà loués ou vendus." },
  { icon: Sparkles, title: "Une sélection qui apprend", desc: "Dites si une annonce vous plaît ou non : les suivantes collent de mieux en mieux à vos goûts." },
  { icon: ImageIcon, title: "Photos, prix et carte", desc: "Chaque annonce arrive avec ses photos, son prix, le nombre de chambres et sa position sur la carte." },
  { icon: Phone, title: "Contact direct", desc: "Le numéro de l'annonceur est affiché : appelez ou écrivez-lui sur WhatsApp, sans intermédiaire." },
];

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
          {/* Vidéo de présentation (30 s, avec voix off). Rien n'est téléchargé avant la lecture. */}
          <Reveal className="max-w-4xl mx-auto mb-14">
          <div className="overflow-hidden rounded-2xl border border-border shadow-2xl bg-black">
            <video
              className="w-full aspect-video"
              src="/video/micasa-gabon-16x9.mp4"
              poster="/video/micasa-gabon-16x9.jpg"
              controls
              playsInline
              preload="none"
              aria-label="Présentation de Mi Casa Gabon en 30 secondes"
            />
          </div>
          </Reveal>
          {/* Les 3 étapes, dans l'ordre de la vidéo, reliées par une ligne sur grand écran. */}
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-12 hidden h-px bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0 md:block" aria-hidden="true" />
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 150} className="h-full">
                <div className="group relative h-full rounded-2xl border border-border bg-card p-6 pt-8 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-[0_18px_40px_-18px_rgba(34,197,94,0.45)] motion-reduce:hover:translate-y-0">
                  <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25 transition-transform duration-300 group-hover:scale-110 motion-reduce:group-hover:scale-100">
                    <step.icon className="h-8 w-8 text-primary" aria-hidden="true" />
                    <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-md">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Avantages pour l'abonné : apparition au défilement, relief au survol. */}
      <section className="py-20 px-4 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <h2 className="text-3xl font-bold text-center mb-3">Tout ce dont vous avez besoin</h2>
            <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
              Moins de temps perdu, de meilleures annonces : Mi Casa Gabon fait le tri pour vous.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {BENEFITS.map((feature, i) => (
              <Reveal key={feature.title} delay={i * 90} className="h-full">
                <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-[0_18px_40px_-18px_rgba(34,197,94,0.45)] motion-reduce:hover:translate-y-0">
                  {/* Halo vert qui s'allume au survol. */}
                  <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/20 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true" />
                  <div className="relative mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg] motion-reduce:group-hover:scale-100 motion-reduce:group-hover:rotate-0">
                    <feature.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  </div>
                  <h3 className="relative font-semibold mb-1.5">{feature.title}</h3>
                  <p className="relative text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              </Reveal>
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
