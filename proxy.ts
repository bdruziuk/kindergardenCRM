import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Everything is private: the app holds children's names, dates of birth and
 * their parents' phone numbers. The only anonymous surfaces are `/login`,
 * `/register` — which is useless without an invite token — and `/api/auth/*`,
 * `/api/register/*`, `/api/health`, all excluded via the matcher below.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Той, хто вже увійшов, на цих сторінках робити нічого не має: обидві
  // заводять сесію, яка в нього вже є.
  if (pathname === "/login" || pathname === "/register") {
    return token
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (token) return NextResponse.next();

  // API callers get a status they can act on rather than a redirect to HTML.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Потрібна авторизація" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!api/auth|api/register|api/health|_next/static|_next/image|favicon.svg|og.png|.*\\.svg$).*)",
  ],
};
