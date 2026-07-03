# GigaPDF — Déploiement blue/green zéro-502

Depuis v1.22.0+, les deploys sont **atomiques par bascule** : le build complet se fait
dans un release horodaté pendant que le site continue de servir l'ancien, puis nginx
bascule gracieusement. Objectif mesuré : une boucle `curl` (2 req/s) pendant tout le
deploy compte **0 réponse ≠ 200**.

## Architecture

```
Laptop ── git push production ──▶ /opt/gigapdf-repo.git (bare)
                                        │ git clone (hardlinks locaux)
                                        ▼
/opt/gigapdf/
├── releases/<ts>-<sha7>/   clone complet buildé (on garde 3)
├── shared/
│   ├── env/gigapdf.env     UNIQUE source d'env (ubuntu:gigapdf 640)
│   ├── venv/               venv Python partagé (uvicorn/celery/alembic)
│   ├── bin/ocr_serve       binaire OCR (+ copie cache de server-deploy.sh)
│   └── state/              active-color, history, hash requirements
├── blue    -> releases/X   slot bleu   → ports web 3000 / admin 3001 / api 8000
├── green   -> releases/Y   slot vert   → ports web 3010 / admin 3011 / api 8010
├── current -> releases/Z   release ACTIF (WorkingDirectory de celery/ocr)
└── (fichiers du vieux clone plat — GELÉS, fallback d'urgence uniquement)

nginx ── include /etc/nginx/gigapdf-upstreams.conf
         (couleur active en primaire, l'autre couleur en `backup`)
```

Données persistantes hors releases : `/var/lib/gigapdf/` (documents, modèles OCR,
cache fastembed), `/var/log/gigapdf/`, `shared/env/gigapdf.env`, `shared/venv/`.

### Units systemd (générées par `server-deploy.sh ensure_units`, source unique)

| Unit | Rôle | Port |
|---|---|---|
| `gigapdf-web-{blue,green}` | Next.js web (standalone) | 3000 / 3010 |
| `gigapdf-admin-{blue,green}` | Next.js admin | 3001 / 3011 |
| `gigapdf-api-{blue,green}` | FastAPI uvicorn --workers 4 | 8000 / 8010 |
| `gigapdf-celery`, `gigapdf-celery-billing` | workers (WorkingDirectory=`current`) | — |
| `gigapdf-ocr` | OCR rten (`shared/bin/ocr_serve`) | 8077 |

`StartLimitBurst/IntervalSec` sont en `[Unit]` (le warning historique « mal placé en
[Service] » est corrigé). Seule la couleur active est `enabled` (reboot-safe).
Les anciennes units plates `gigapdf-{web,admin,api}` sont stoppées + disabled mais
laissées sur disque (fallback legacy).

## Séquence d'un deploy

1. `git push production main` (bare repo).
2. `server-deploy.sh deploy --sha <HEAD>` sur le VPS (shippé par le wrapper) :
   clone release → symlinks env (AVANT build : inlining `NEXT_PUBLIC_*`) →
   `pnpm install` + `pnpm update gigapdf-lib@latest` → sync venv (si requirements
   changé) → **migrations SQL manuelles + alembic** → `turbo build --force
   --concurrency=1` → build web + admin (échec admin = FATAL, le site reste sur
   l'ancien release) → BUILD_ID + rsync standalone static/public → fetch OCR
   (idempotent, marker SHA) → chown release à gigapdf.
3. Bascule : démarrage de la couleur INACTIVE → gates santé
   (`/health` API 200, `/` web 200/3xx, `/admin` 200/3xx, puis 8 s de stabilisation +
   `NRestarts ≤ 3`) → **si un gate échoue : stop de la couleur cible, le site n'a
   jamais quitté l'ancien release** → réécriture de l'include upstreams (cible en
   primaire, ancienne couleur en `backup`) → `nginx -t` → `systemctl reload nginx`
   (graceful, zéro drop) → drain borné 45 s des anciens workers nginx → stop de
   l'ancienne couleur (les workers nginx retardataires basculent sur le `backup`).
4. `current` → nouveau release, restart celery (SIGTERM = warm shutdown, les tâches
   en cours finissent, `TimeoutStopSec=300`) + OCR **uniquement si son binaire/ses
   modèles ont changé**.
5. Purge : garde les 3 releases les plus récents (jamais ceux pointés par
   blue/green/current). Verrou `flock` anti-deploys concurrents.

## Procédures

### Deploy (laptop)
```bash
GIGAPDF_VPS_HOST=51.159.105.179 bash deploy/redeploy.sh          # complet
bash deploy/redeploy.sh --web-only    # ne restart pas celery (les workers gardent l'ancien code !)
bash deploy/redeploy.sh --skip-push   # le bare repo a déjà HEAD
bash deploy/redeploy.sh --strict      # échec dur sur tout smoke-check
```

### Rollback (< 30 s, laptop)
```bash
GIGAPDF_VPS_HOST=51.159.105.179 bash deploy/rollback.sh              # → release précédent
GIGAPDF_VPS_HOST=51.159.105.179 bash deploy/rollback.sh --to blue    # couleur explicite
```
Mêmes gates santé qu'un deploy : si le release précédent ne démarre pas sain, rien
n'est basculé. Celery/OCR sont re-basculés aussi. Le venv partagé n'est PAS
rollbacké (si `requirements.txt` a changé entre les deux releases, vérifier la
compat ou re-déployer en avant).

### État / debug (sur le VPS)
```bash
bash /opt/gigapdf/shared/bin/server-deploy.sh status   # couleur active, releases, HEAD, disque
cat /opt/gigapdf/shared/state/history                  # journal des bascules
cat /etc/nginx/gigapdf-upstreams.conf                  # ports actifs
tail -50 /var/log/gigapdf/{web,api,admin}-error.log    # les 2 couleurs écrivent dans les mêmes logs
systemctl status gigapdf-web-green                     # etc.
```

### CI auto-deploy
`/usr/local/bin/gigapdf-ci-deploy.sh` (forced-command SSH, réinstallé automatiquement
à chaque deploy depuis `deploy/gigapdf-ci-deploy.sh`) : fetch `github/main` → bare
(fast-forward only) puis exécute `server-deploy.sh` du commit déployé (fallback :
copie cache `shared/bin/`). Plus aucun `chown -R /opt/gigapdf` ni restart des units
legacy.

### Fallback d'urgence vers le clone plat (dernier recours)
Valide UNIQUEMENT tant que la couleur `blue` n'est pas active (le legacy occupe les
ports 3000/3001/8000) :
```bash
bash /opt/gigapdf/shared/bin/server-deploy.sh switch --to legacy
```
Attention : celery/ocr restent sur `current` (release). Si `blue` est actif, passer
d'abord par `switch --to green`.

## Limites connues / notes d'exploitation

- **Requêtes très longues pendant la bascule** : un upload/export en vol sur
  l'ancienne couleur au moment du stop (après le drain de 45 s) est coupé — le
  client doit réessayer. Les websockets (socket.io) sont coupés au stop de
  l'ancienne API et se reconnectent sur la nouvelle.
- **`deploy.sh` (legacy)** : gardé pour référence, verrouillé par un garde-fou
  (refuse de tourner si `shared/state/active-color` existe).
- **Hook `post-receive` du bare repo** (`/opt/gigapdf-repo.git/hooks/post-receive`,
  NON versionné) : neutralisé le 2026-07-03 (backup `post-receive.pre-bluegreen.bak`).
  L'ancien hook faisait `chown -R /opt/gigapdf` + deploy legacy à chaque push — il
  aurait cassé les perms de `shared/env` et raced la bascule. Un push ne déclenche
  plus AUCUN deploy côté hook : c'est `redeploy.sh` ou le CI qui déploie.
- **`--web-only`** : ne saute plus le build API (le release est toujours complet),
  il saute seulement le restart celery.
- **Venv partagé** : re-synchronisé uniquement quand le hash de `requirements.txt`
  change. Un rollback ne le rétrograde pas.
- **Logs** : les deux couleurs écrivent dans les mêmes fichiers
  (`/var/log/gigapdf/*.log`) — la rotation logrotate existante est inchangée.
- **Espace disque** : garde-fou 10 G libres avant build ; 3 releases ≈ 3×~2,5 G
  (node_modules majoritairement hardlinkés sur le store pnpm).
- Optionnel (non appliqué) : `worker_shutdown_timeout 60s;` dans le bloc main de
  `/etc/nginx/nginx.conf` bornerait les workers nginx retardataires — le `backup`
  d'upstream couvre déjà ce cas.
