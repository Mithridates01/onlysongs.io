import { OnboardingForm } from "@/components/OnboardingForm";
import { redirectUri } from "@/lib/env";
import { currentSession } from "@/lib/http";
import { buildStatus } from "@/lib/status";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  const status = session ? await buildStatus(session.sub) : null;
  const params = await searchParams;
  return (
    <OnboardingForm
      redirectUri={status?.redirectUri ?? redirectUri()}
      clientIdLast4={status?.clientIdLast4 ?? null}
      errorCode={params.error}
      connected={status?.connection === "connected" || status?.connection === "quota_paused"}
    />
  );
}
