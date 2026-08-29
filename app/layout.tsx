import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { resolveTheme } from "@/lib/theme";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "Малеча — облік дитячого садочка",
  description: "Філії, групи, оплати, колектив та фінансові звіти в одному місці.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Малеча",
    description: "Облік садочка без зайвого клопоту",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Малеча",
    description: "Облік садочка без зайвого клопоту",
    images: ["/og.png"],
  },
};

/** Схему ставимо на сервері, щоб сторінка не блимнула типовою й лише потім
 *  перефарбувалась. Через це рендер стає динамічним — за автентифікацією тут
 *  і так усе. */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const theme = await resolveTheme();

  return (
    <html lang="uk" data-theme={theme}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
