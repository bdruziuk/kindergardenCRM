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
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    hasAvatar?: boolean;
  }
}
