# France Travail → Google Sheets (TypeScript + clasp)

Outil Google Sheets qui importe automatiquement les offres d’emploi **France Travail (Offres v2)** correspondant à :

- `motsCles = "travailleur social"`
- `publieeDepuis = 1` (≈ dernières 24h)

Les offres sont ajoutées dans une feuille **Offres** avec :
- **déduplication** via une colonne technique masquée `offre_id`
- **exclusions** via un onglet **Exclusions** (intitulé / entreprise)
- **mise en forme** (en-têtes, freeze, hauteurs fixes, largeurs, wrap CLIP)
- **lien cliquable uniquement sur l’intitulé** vers la page FT
- **OAuth2 client_credentials** avec token en cache (~50 min)
- **secrets** demandés à l’ouverture si absents, stockés uniquement dans **Script Properties**

> Aucun statut / suivi / enrichissement entreprise / LinkedIn : volontairement absent.

## Aide (pour les utilisateurs du Google Sheet)

### Mise à jour automatique (tous les jours à minuit)

- La feuille est **mise à jour automatiquement chaque jour à 00:00** (heure du fichier / fuseau du script).
- La mise à jour récupère les **offres publiées sur les dernières 24h** et les ajoute dans l’onglet **Offres**.
- Tu peux aussi lancer la mise à jour manuellement via le menu **France Travail → Mettre à jour (24h)**.

> Si tu ne vois pas la mise à jour quotidienne, vérifie que l’accès au script est autorisé (première exécution) et que les déclencheurs (triggers) ne sont pas désactivés côté Apps Script.

### Secrets / accès à l’API France Travail

Pour interroger l’API France Travail, le script a besoin de 2 informations :

- `FT_CLIENT_ID`
- `FT_CLIENT_SECRET`

Fonctionnement :

- **À l’ouverture du fichier**, si ces secrets n’existent pas encore, une fenêtre te demande de les saisir.
- Ils sont ensuite stockés de façon sécurisée dans les **Propriétés du script (Script Properties)**.
- Le script récupère un **token OAuth** (client_credentials) et le conserve en cache pendant ~**50 minutes**.

Important :

- Les secrets ne sont **pas** écrits dans la feuille.
- Si les secrets changent, utilise **France Travail → Configurer les secrets**.
- En cas d’erreur d’authentification (401), le script purge le cache puis réessaie une fois.

### Données importées / où elles sont stockées

- Les offres sont ajoutées dans l’onglet **Offres**.
- Chaque offre est identifiée par un champ technique **`offre_id`** (colonne masquée) :
  - c’est la **seule** base de déduplication (une offre déjà vue n’est pas réimportée).
- Le texte long (résumé / description) est stocké en **note** sur la cellule `resume` pour garder une feuille lisible.

### Exclusions (filtrer certaines offres)

L’onglet **Exclusions** permet d’ignorer automatiquement certaines offres :

- Col A : règles sur **intitulé**
- Col B : règles sur **entreprise**

Règles possibles :

- Texte simple : match par **contains** après normalisation (trim, lowercase, sans accents, espaces normalisés)
- Regex : format `/pattern/flags`

---

## Structure

```
.
├── src/
│   ├── config.ts
│   ├── secrets.ts
│   ├── ftApi.ts
│   ├── exclusions.ts
│   ├── sheet.ts
│   ├── jobs.ts
│   └── main.ts
├── dist/               # généré par tsc (clasp push doit pousser dist/)
├── appsscript.json
├── package.json
└── tsconfig.json
```

## Prérequis

- Node.js 18+
- `clasp` (installé via devDependencies)
- Un projet Apps Script lié à un Google Sheet (Container-bound)

## Installation

```bash
npm i
```

Initialiser clasp (si besoin) :

```bash
npm run login
clasp create --type sheets --title "France Travail Offres"
```

> Si tu as déjà un projet existant : place simplement le `.clasp.json` à la racine (ou fais `clasp clone <scriptId>`).

## Build & Push

```bash
npm run push
```

## Utilisation dans Google Sheets

À l’ouverture du fichier :
- si `FT_CLIENT_ID` / `FT_CLIENT_SECRET` manquent, un popup demande de les saisir
- puis un menu **France Travail** apparaît

Menu **France Travail** :
- **Mettre à jour (24h)** : exécute `ftUpdateTravailleurSocial_24h`
- **Configurer les secrets** : force la saisie + stocke dans Script Properties
- **Ouvrir l’onglet Exclusions** : ouvre la feuille `Exclusions`
- **Aide / README** : rappel du fonctionnement

## Exclusions

Onglet **Exclusions** :

- Col A : règles sur **intitulé**
- Col B : règles sur **entreprise**

Règles :
- Texte simple : match par **contains** après normalisation (trim, lowercase, sans accents, espaces normalisés)
- Regex : format `/pattern/flags`

## Notes techniques

- Déduplication : **uniquement** via la colonne masquée `offre_id`.
- Description longue : stockée en **note** sur la cellule `resume` (pour éviter de gonfler la hauteur).
- Logs : visibles dans **Executions** / Cloud Logs.

## Sécurité

- Secrets stockés en **Script Properties**
- Token OAuth stocké en **CacheService** (TTL 50 min)
- Si un `search` renvoie 401 : purge du cache + retry 1 fois

## Deux déploiements séparés (dev / prod)

Ce repo peut pousser le même code vers **deux projets Apps Script différents** (ex: ton fichier vs la prod cliente).

### Fichiers

- `.clasp.dev.json` : configuration dev (ton `scriptId`)
- `.clasp.prod.json` : configuration prod (scriptId cliente)
- `.clasp.json` : **configuration active** utilisée par `clasp` (générée via les commandes ci-dessous)

Renseigne les `scriptId` dans `.clasp.dev.json` et `.clasp.prod.json`.

### Commandes

- Pousser vers ton environnement dev :
  - `npm run push:dev`
- Pousser vers la prod cliente :
  - `npm run push:prod`

Par défaut, `npm run push` exécute `push:dev`.

> Note: `clasp` ne gère qu’un seul `.clasp.json` à la fois. Les scripts `use:dev` / `use:prod` copient le bon fichier vers `.clasp.json` avant le `clasp push`.
