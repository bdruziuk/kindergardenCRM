/**
 * Міграції накочуються на старті сервера.
 *
 * Railway запускає один образ і не має окремого кроку релізу всередині нього,
 * тож найнадійніше місце застосувати схему — саме тут: `register()`
 * викликається один раз на інстанс і мусить завершитись, перш ніж сервер
 * почне приймати запити. Якщо міграція впаде, застосунок не підніметься —
 * це навмисно: працювати на схемі, якої код не очікує, гірше, ніж не
 * стартувати зовсім, а Railway перезапустить контейнер.
 *
 * Розраховано на один інстанс (`numReplicas: 1` у `railway.json`). Кільком
 * реплікам, що стартують одночасно, знадобився б окремий крок міграції.
 */
export async function register() {
  // `register()` викликається для кожного рантайму, а на edge крутиться лише
  // proxy.ts — SQL там ні до чого.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_DB_MIGRATIONS === "1") return;
  // Локальна збірка чи запуск без бази — не привід падати на старті.
  if (!process.env.DATABASE_URL) return;

  const { runMigrations } = await import("@/lib/migrate");
  await runMigrations();

  // На щойно розгорнутій базі входити нікому — заводимо власника, якщо для
  // цього задані змінні. Спрацює лише поки користувачів немає жодного.
  const { bootstrapOwner, bootstrapSuperadmin } = await import(
    "@/lib/bootstrap"
  );
  const owner = await bootstrapOwner();
  if (owner) console.log(`Створено власника: ${owner}`);

  // Роль з'явилася пізніше за перші акаунти, тож її заводимо окремо — на вже
  // заселеній базі перевірка «жодного користувача» не спрацювала б.
  const superadmin = await bootstrapSuperadmin();
  if (superadmin) console.log(`Створено супер-адміністратора: ${superadmin}`);
}
