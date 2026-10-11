import "next-auth";
import "next-auth/jwt";

type Role = "superadmin" | "admin" | "manager" | "teacher";

declare module "next-auth" {
  interface User {
    role: Role;
    hasAvatar?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      hasAvatar?: boolean;
      name?: string | null;
      email?: string | null;
      /** Хто насправді за кермом, поки супер-адміністратор працює від імені
       *  власника чи керуючого. Без імперсонації — відсутнє. */
      actor?: { id: string; name: string };
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    hasAvatar?: boolean;
    /** id і ім'я супер-адміністратора, поки він працює від чужого імені. */
    actorId?: string;
    actorName?: string;
  }
}
