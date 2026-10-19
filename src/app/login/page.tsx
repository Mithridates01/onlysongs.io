import { AuthForm } from "@/components/AuthForm";
import { signupsOpen } from "@/lib/early-access";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <AuthForm mode="login" inviteOnly={!signupsOpen()} />;
}
