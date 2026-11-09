import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { findUserByIdentifier, verifyPassword } from "@/lib/auth/users";
import { isAdminEmail } from "@/lib/env";

const credentialsSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "اسم المستخدم أو البريد الإلكتروني", type: "text" },
        password: { label: "كلمة المرور", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await findUserByIdentifier(parsed.data.identifier);
        if (!user) return null;
        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isAdmin: isAdminEmail(user.email),
        };
      },
    }),
  ],
});

/** Convenience helpers for server components / actions. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

export async function requireAdmin() {
  const session = await auth();
  const user = session?.user;
  // Re-check against the allow-list every time: the JWT may be older than an env change.
  if (!user?.id || !user.email || !isAdminEmail(user.email)) return null;
  return user;
}
