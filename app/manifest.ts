import type { MetadataRoute } from "next";

/** Робить сайт застосунком, який можна встановити на телефон: іконка на
 *  головному екрані, відкриття на весь екран без адресного рядка. Кольори —
 *  нейтральний фон сторінки (`--bg`), щоб рядок стану й заставка не
 *  сперечалися з вибраною кольоровою схемою. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Малеча — облік дитячого садочка",
    short_name: "Малеча",
    description: "Філії, групи, оплати, колектив та фінансові звіти в одному місці.",
    lang: "uk",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f7f6",
    theme_color: "#f5f7f6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
