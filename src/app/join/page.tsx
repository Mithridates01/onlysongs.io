import { InviteInvalid, JoinForm } from "@/components/AccountFlows";
import { findInvite } from "@/lib/early-access";

export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // Looking the invite up does not spend it; only finishing sign-up does.
  const invite = await findInvite(token);
  if (!invite || !token) return <InviteInvalid />;
  return <JoinForm email={invite.email} token={token} />;
}
