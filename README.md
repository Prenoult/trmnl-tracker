# TRMNL Queue Tracker

Suivi quotidien de la position dans la file d'attente TRMNL (commande #51230),
avec historique et progression.

## Comment ça marche

- [`scripts/scrape.mjs`](scripts/scrape.mjs) reproduit les 3 requêtes que fait
  un vrai navigateur sur `trmnl.com/order-tracker` (la page ne contient la
  position qu'après un submit de formulaire déclenché par du JS côté client —
  un simple GET ne suffit pas). Le résultat est ajouté/mis à jour dans
  [`data/history.json`](data/history.json), une entrée par jour.
- Un workflow GitHub Actions ([`.github/workflows/track.yml`](.github/workflows/track.yml))
  lance ce script chaque jour à 07:00 UTC et commit le fichier mis à jour.
- [`index.html`](index.html) est une mini appli web (PWA) qui lit
  `data/history.json` et affiche : position actuelle, places gagnées/perdues
  depuis la veille, commandes ajoutées à la file, courbe de progression, et
  une estimation du nombre de jours restants au rythme actuel.

Aucun serveur à faire tourner : tout est statique, hébergeable gratuitement
sur GitHub Pages.

## Déploiement (5 minutes)

1. Crée un dépôt GitHub (public ou privé) et pousse ce dossier dedans :

   ```bash
   cd ~/dev/trmnl-tracker
   git init
   git add -A
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<ton-user>/trmnl-tracker.git
   git push -u origin main
   ```

2. Dans les réglages du dépôt (**Settings → Pages**), choisis **Deploy from a
   branch**, branche `main`, dossier `/ (root)`.
3. Dans **Settings → Actions → General → Workflow permissions**, sélectionne
   **Read and write permissions** (nécessaire pour que le workflow puisse
   commit `data/history.json`).
4. L'appli sera accessible sur `https://<ton-user>.github.io/trmnl-tracker/`.
   Ouvre ce lien sur ton téléphone, puis **Partager → Sur l'écran d'accueil**
   (Safari) pour l'installer comme une vraie appli.
5. Le workflow tourne automatiquement chaque jour. Pour lancer un relevé
   immédiatement sans attendre : onglet **Actions** du dépôt → *Track queue
   position* → **Run workflow**.

## Changer de commande

Édite `ORDER_NUMBER` dans [`.github/workflows/track.yml`](.github/workflows/track.yml)
et dans [`app.js`](app.js) (`const ORDER_NUMBER = "..."`).

## Tester en local

```bash
node scripts/scrape.mjs   # met à jour data/history.json
python3 -m http.server 8080   # puis ouvre http://localhost:8080
```
