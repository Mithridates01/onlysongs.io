import { AuthForm } from "@/components/AuthForm";
import { signupsOpen } from "@/lib/early-access";
import { safeNextPath } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" inviteOnly={!signupsOpen()} returnTo={safeNextPath(next)} />;
}
