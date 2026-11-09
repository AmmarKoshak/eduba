import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe part of the Auth.js configuration (no database imports), shared by
 * `middleware.ts` and `auth.ts`.
 */
export const authConfig = {
  pages: {
    signIn: "/sign-in",
    newUser: "/sign-up",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const loggedIn = !!auth?.user;
      if (pathname.startsWith("/admin")) {
        // Anonymous → sign-in. Logged-in non-admins get the 403 page from the
        // admin layout (returning false here would loop them through sign-in).
        return loggedIn;
      }
      if (pathname.startsWith("/account")) return loggedIn;
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.isAdmin = user.isAdmin;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as "student" | "parent" | undefined) ?? "student";
        session.user.isAdmin = token.isAdmin === true;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
