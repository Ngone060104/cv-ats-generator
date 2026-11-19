-- À exécuter UNE SEULE FOIS sur ta base existante pour la traduction du CV et de la lettre.
CREATE TABLE IF NOT EXISTS application_translations (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language        VARCHAR(2) NOT NULL CHECK (language IN ('fr','en','it','es')),
  cv_json         JSONB,
  cover_letter    TEXT,
  model_used      VARCHAR(80),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, language)
);
