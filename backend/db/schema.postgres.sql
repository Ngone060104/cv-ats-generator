-- CV ATS Generator - schéma PostgreSQL
-- Prérequis (à exécuter séparément) : CREATE DATABASE cv_ats;
-- Puis se connecter à la base cv_ats avant d'exécuter ce fichier.
-- Note : updated_at est mis à jour par le code (SET updated_at = NOW()), pas par un trigger.

CREATE TYPE user_plan AS ENUM ('free', 'pro');
CREATE TYPE application_status AS ENUM ('brouillon', 'postule', 'relance', 'entretien', 'refus', 'offre');

-- ---------------------------------------------------------------
-- Utilisateurs (quota prêt pour une future version SaaS)
-- ---------------------------------------------------------------
CREATE TABLE users (
  id                          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                       VARCHAR(190) NOT NULL UNIQUE,
  password_hash               VARCHAR(255) NOT NULL,
  plan                        user_plan NOT NULL DEFAULT 'free',
  monthly_quota               INTEGER NOT NULL DEFAULT 1000,
  generations_used_this_month INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Profil maître : source de vérité unique
-- ---------------------------------------------------------------
CREATE TABLE profiles (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name      VARCHAR(150) NOT NULL,
  headline       VARCHAR(190),
  email          VARCHAR(190),
  phone          VARCHAR(40),
  city           VARCHAR(100),
  country        VARCHAR(100),
  linkedin_url   VARCHAR(255),
  github_url     VARCHAR(255),
  portfolio_url  VARCHAR(255),
  base_summary   TEXT,
  strengths      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- atouts
  interests      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- centres d'intérêt
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE educations (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school      VARCHAR(190) NOT NULL,
  degree      VARCHAR(190) NOT NULL,
  start_date  CHAR(7),            -- AAAA-MM
  end_date    CHAR(7),            -- NULL = en cours
  details     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE experiences (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company     VARCHAR(190) NOT NULL,
  role        VARCHAR(190) NOT NULL,
  location    VARCHAR(150),
  start_date  CHAR(7),
  end_date    CHAR(7),
  bullets     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE projects (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          VARCHAR(190) NOT NULL,
  description   TEXT NOT NULL,
  technologies  JSONB NOT NULL DEFAULT '[]'::jsonb,
  bullets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  url           VARCHAR(255),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE skills (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category    VARCHAR(80) NOT NULL,
  name        VARCHAR(80) NOT NULL,
  CONSTRAINT uq_skill UNIQUE (profile_id, name)
);

CREATE TABLE languages (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        VARCHAR(60) NOT NULL,
  level       VARCHAR(60) NOT NULL
);

-- ---------------------------------------------------------------
-- Offres analysées
-- ---------------------------------------------------------------
CREATE TABLE job_offers (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_url  VARCHAR(500),
  raw_text    TEXT NOT NULL,
  company     VARCHAR(190),
  job_title   VARCHAR(190),
  analysis    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- Candidatures générées + suivi
-- ---------------------------------------------------------------
CREATE TABLE applications (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_offer_id      INTEGER NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
  cv_json           JSONB NOT NULL,
  cover_letter      TEXT NOT NULL,
  match_score       SMALLINT CHECK (match_score BETWEEN 0 AND 100),
  keywords_matched  JSONB,
  keywords_missing  JSONB,
  status            application_status NOT NULL DEFAULT 'brouillon',
  applied_at        DATE,
  follow_up_at      DATE,
  notes             TEXT,
  interview_at      TIMESTAMPTZ,             -- date et heure de l'entretien
  contact_name      VARCHAR(150),            -- personne qui t'a contactée
  contact_info      VARCHAR(190),            -- téléphone ou e-mail
  advice            JSONB,                   -- conseils de l'IA pour combler les manques
  model_used        VARCHAR(80),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versions traduites du CV et de la lettre (une par langue et par candidature)
CREATE TABLE application_translations (
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

CREATE INDEX idx_applications_user_status ON applications (user_id, status);
