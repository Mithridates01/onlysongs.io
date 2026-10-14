import { SettingsForm } from "@/components/SettingsForm";
import { currentSession } from "@/lib/http";
import { buildStatus } from "@/lib/status";

export default async function SettingsPage() {
  const session = await currentSession();
  const status = session ? await buildStatus(session.sub) : null;
  if (!status) return <p>Account setup is incomplete.</p>;
  return <SettingsForm initial={status} />;
}
