import { SubscriberSignup } from "@/components/subscriber-signup";

/** Lien d'inscription d'un agent : ses abonnés s'inscrivent ici et lui sont rattachés. */
export default async function DemandePage(props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  return <SubscriberSignup userId={params.userId} />;
}
