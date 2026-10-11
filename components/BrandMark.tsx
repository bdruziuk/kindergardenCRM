import Image from "next/image";

/**
 * Знак «Малечі» — «М» з усмішкою. Один компонент на меню й сторінки входу,
 * щоб логотип мінявся в одному місці.
 *
 * Векторний файл, тож оптимізатор зображень Next тут нічого не дає;
 * `alt` порожній, бо поруч завжди стоїть назва «Малеча» текстом.
 */
export function BrandMark() {
  return (
    <Image
      className="brand-mark"
      src="/logo-mark.svg"
      alt=""
      width={40}
      height={40}
      unoptimized
      priority
    />
  );
}
