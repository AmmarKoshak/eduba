import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/**
 * Route protection for /admin and /account. Uses the edge-safe config only
 * (no database access here); the `authorized` callback decides.
 */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/admin/:path*", "/account/:path*"],
};
