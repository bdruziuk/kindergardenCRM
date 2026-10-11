-- Режим перегляду для користувача: ставить супер-адміністратор у кабінеті.
-- (Таблиця cash_opening_balances, яку drizzle-kit намагався створити тут же,
-- уже є — її завела ручна міграція 0032 без знімка схеми.)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "read_only" boolean DEFAULT false NOT NULL;
