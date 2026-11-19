-- À exécuter UNE SEULE FOIS sur ta base existante pour la déconnexion (invalidation des tokens).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
