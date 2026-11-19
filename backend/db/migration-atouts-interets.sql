-- À exécuter UNE SEULE FOIS sur ta base existante (cv_ats) pour ajouter les atouts et centres d'intérêt.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS strengths JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS interests JSONB NOT NULL DEFAULT '[]'::jsonb;
