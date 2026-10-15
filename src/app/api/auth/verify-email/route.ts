import { consumeToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/db";
import { json, parseJson } from "@/lib/http";
import { tokenBody } from "@/lib/schemas";

// The emailed link opens a page that posts here, so a mail scanner that only
// follows links cannot use up the token.
export async function POST(request: Request) {
  const body = await parseJson(request, tokenBody, "This link is invalid, expired, or already used.");
  if (!body.ok) return body.response;
  const userId = await consumeToken(body.data.token, "verify_email");
  if (!userId) return json({ error: "This link is invalid, expired, or already used." }, 400);
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  return json({ ok: true });
}
