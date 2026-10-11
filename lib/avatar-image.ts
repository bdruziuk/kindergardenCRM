/**
 * Спільне для аватарок користувачів і фото працівників: обидва — квадрат
 * 256 px, обрізаний у браузері ще до відправки.
 */

/**
 * Зменшує знімок до квадрата 256 px просто в браузері.
 *
 * Так на сервер їде десяток кілобайт замість фотографії з телефона, і не
 * потрібна бібліотека обробки зображень: аватарка все одно показується
 * розміром із ніготь.
 */
export async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не дав полотна для обробки зображення");

  // Обрізаємо по центру, а не стискаємо: інакше обличчя на широкому кадрі
  // виходило б сплюснутим.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", 0.85);
  // Старий браузер міг мовчки віддати PNG замість webp — беремо що вийшло.
  return webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", 0.85);
}
