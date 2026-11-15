import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriberSignup } from "@/components/subscriber-signup";
import { ownerUserId } from "@/lib/owner";
import { AgentSignupForm } from "./agent-form";

// « Créer un compte » : un visiteur est un futur abonné. Il s'inscrit ici (nom, numéro WhatsApp
// confirmé par code, critères) et arrive dans son espace client — jamais dans l'administration.
// Le compte agent se crée à part, par email : /signup?agent=1.

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: { agent?: string } }) {
  if (searchParams.agent === "1") return <AgentSignupForm />;

  const ownerId = await ownerUserId();
  if (ownerId) return <SubscriberSignup userId={ownerId} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Inscription indisponible</CardTitle>
          <CardDescription>Les inscriptions ne sont pas encore ouvertes. Réessayez un peu plus tard.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/">
            <Button variant="outline" className="w-full">Retour à l&apos;accueil</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
