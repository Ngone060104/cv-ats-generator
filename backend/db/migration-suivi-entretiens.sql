-- À exécuter UNE SEULE FOIS sur ta base existante pour le suivi des entretiens.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_name VARCHAR(150);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_info VARCHAR(190);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS advice JSONB;
