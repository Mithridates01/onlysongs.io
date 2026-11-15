// Operator rights need the admin flag and a verified email. The flag is set at
// sign-up from ADMIN_EMAIL, so without the verified inbox anyone who signed up
// first with that address would be the operator.
export function isOperator(user: { isAdmin: boolean; emailVerifiedAt: Date | null } | null | undefined): boolean {
  return Boolean(user?.isAdmin && user.emailVerifiedAt);
}
