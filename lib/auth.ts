import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { getDb } from "@/db";
import { users } from "@/db/schema";

/** Від чийого імені супер-адміністратор може працювати. Вихователя тут
 *  немає: просили власника й керуючого, і ширше відкривати нема потреби. */
const IMPERSONABLE = new Set<string>(["admin", "manager"]);

async function loadAccount(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatar: users.avatar,
      kindergartenId: users.kindergartenId,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

/**
 * Токен стає токеном цього акаунта. Усе на сервері читає саме `id` з сесії й
 * роль із бази, тож далі застосунок бачить рівно те, що бачить цей акаунт, і
 * пускає рівно туди, куди пускає його.
 */
function becomes(
  token: JWT,
  account: NonNullable<Awaited<ReturnType<typeof loadAccount>>>,
) {
  token.id = String(account.id);
  token.sub = String(account.id);
  token.role = account.role;
  token.name = account.name;
  token.email = account.email;
  token.hasAvatar = Boolean(account.avatar);
}

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
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.hasAvatar = user.hasAvatar;
      }
      // Вхід від чужого імені й повернення. Обидва приходять через
      // `useSession().update(...)`, тобто від клієнта, — тож нічому з тіла
      // запиту не віримо: роль того, хто перемикає, і роль цілі беремо з бази.
      if (trigger === "update" && session?.impersonate != null) {
        const actor = await loadAccount(Number(token.actorId ?? token.id));
        const target = await loadAccount(Number(session.impersonate));
        if (
          actor?.role === "superadmin" &&
          target &&
          IMPERSONABLE.has(target.role) &&
          target.kindergartenId
        ) {
          // Слід у логах сервера: хто, від чийого імені й коли почав працювати.
          console.info(
            `impersonation: superadmin ${actor.id} acts as ${target.role} ${target.id}`,
          );
          token.actorId = String(actor.id);
          token.actorName = actor.name || actor.email;
          becomes(token, target);
        }
      }
      if (trigger === "update" && session?.stopImpersonating && token.actorId) {
        const actor = await loadAccount(Number(token.actorId));
        delete token.actorId;
        delete token.actorName;
        if (actor) becomes(token, actor);
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
        if (token.actorId)
          session.user.actor = {
            id: token.actorId,
            name: token.actorName ?? "",
          };
      }
      return session;
    },
  },

  pages: { signIn: "/login" },

  secret: process.env.NEXTAUTH_SECRET,
};
