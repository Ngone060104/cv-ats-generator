# CV ATS Generator

Colle le lien (ou le texte) d'une offre : l'application génère un CV ATS et une lettre de motivation adaptés, à partir de ton profil maître, sans rien inventer.

Stack : Node.js (Express) + PostgreSQL + API Claude. Front Angular à venir.

## Structure

```
backend/
├── db/schema.postgres.sql        # schéma PostgreSQL (8 tables)
├── .env.example
└── src/
    ├── server.js                 # Express + gestionnaire d'erreurs central
    ├── db.js                     # pool pg + transactions
    ├── errors.js                 # AppError + messages clairs (clé, solde, limite)
    ├── asyncHandler.js
    ├── middleware/auth.js        # JWT
    ├── routes/
    │   ├── auth.js               # inscription / connexion
    │   ├── profile.js            # profil maître
    │   ├── generate.js           # génération CV + lettre
    │   └── applications.js       # suivi des candidatures
    ├── services/
    │   ├── export/               # shared.js (sections ATS), pdf.js, docx.js
    │   ├── profileService.js     # lecture / écriture du profil maître
    │   ├── offerFetcher.js       # lecture du lien + repli "coller le texte"
    │   └── generator.js          # appel Claude + validation + garde-fou anti-invention
    └── prompts/
        ├── recruiterPrompt.js    # prompt "expert en recrutement"
        └── outputSchema.json     # schéma JSON de sortie
```

## Configuration (backend/.env)

```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://postgres:MOT_DE_PASSE@localhost:5432/cv_ats
JWT_SECRET=<valeur aléatoire>     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ALLOW_REGISTRATION=true           # false une fois ton compte créé
```

## Démarrage

```bash
cd backend
npm install
npm run dev
```

## API

Toutes les routes sauf `/auth/*` et `/health` demandent l'en-tête `Authorization: Bearer <token>`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | /api/auth/register | `{ email, password }` → token |
| POST | /api/auth/login | `{ email, password }` → token |
| GET | /api/profile | profil maître (ou `null`) |
| PUT | /api/profile | remplace tout le profil maître |
| POST | /api/generate | `{ url?, offerText? }` → CV, lettre, score, candidature enregistrée |
| GET | /api/applications | liste pour le suivi |
| GET | /api/applications/:id | détail (CV, lettre, mots-clés) |
| PATCH | /api/applications/:id | statut, dates, notes, retouches du CV / de la lettre |
| GET | /api/applications/:id/export?type=cv\|letter&format=pdf\|docx | télécharge le CV ou la lettre au format ATS |
| DELETE | /api/applications/:id | suppression |

Format des dates du profil : `AAAA-MM` (ex. `2024-09`).
Statuts : `brouillon`, `postule`, `relance`, `entretien`, `refus`, `offre`.

## Erreurs courantes

| Code | Signification |
|---|---|
| API_KEY_INVALID | clé Claude invalide ou expirée : en créer une nouvelle dans la Claude Console |
| NO_CREDIT | solde API épuisé : recharger dans la Console |
| RATE_LIMIT | trop de requêtes : attendre une minute |
| needsManualPaste | site qui bloque la lecture (LinkedIn, Indeed) : coller le texte de l'offre |

## Prochaines étapes

1. Front Angular : profil, génération, éditeur de CV, suivi des candidatures, téléchargement des fichiers
