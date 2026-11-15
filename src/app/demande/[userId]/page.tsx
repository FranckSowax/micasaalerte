import { SubscriberSignup } from "@/components/subscriber-signup";

/** Lien d'inscription d'un agent : ses abonnés s'inscrivent ici et lui sont rattachés. */
export default function DemandePage({ params }: { params: { userId: string } }) {
  return <SubscriberSignup userId={params.userId} />;
}
