import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Пошта", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const [user] = await getDb()
          .select()
          .from(users)
          .where(eq(users.email, credentials.email.trim().toLowerCase()));
        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password,
          user.passwordHash,
        );
        if (!valid) return null;

        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          role: user.role,
          // Лише прапорець: сам знімок у куку сесії не влізе, а сайдбару
          // достатньо знати, чи є що завантажувати з /api/avatar.
          hasAvatar: Boolean(user.avatar),
        };
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.hasAvatar = user.hasAvatar;
      }
      // Ім’я живе в токені, тож зміна ПІБ у налаштуваннях була б помітна лише
      // після наступного входу. `useSession().update({ name })` доходить сюди
      // саме так і оновлює токен одразу.
      if (trigger === "update" && typeof session?.name === "string") {
        token.name = session.name;
      }
      if (trigger === "update" && typeof session?.hasAvatar === "boolean") {
        token.hasAvatar = session.hasAvatar;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.role = token.role ?? "admin";
        session.user.hasAvatar = token.hasAvatar ?? false;
      }
      return session;
    },
  },

  pages: { signIn: "/login" },

  secret: process.env.NEXTAUTH_SECRET,
};
