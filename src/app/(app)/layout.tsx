import { redirect } from "next/navigation";
import { VerifyBanner } from "@/components/AccountFlows";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) redirect("/login");
  return (
    <Shell email={user.email} admin={user.isAdmin}>
      {user.emailVerifiedAt ? null : <VerifyBanner />}
      {children}
    </Shell>
  );
}
