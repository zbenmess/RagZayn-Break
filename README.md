# RagZayn Break

Jeu web 3D de défoulement « ragdoll physics », conçu pour être joué sur iPhone,
installé depuis Safari comme application sur l'écran d'accueil (PWA).

Le héros du jeu est **Zayn** : un petit personnage low‑poly, visible au premier
plan, qui lance les objets et déclenche les pièges sur un mannequin de bois
articulé. À chaque victoire, le jeu affiche et prononce « **Bravo Zayn !** ».

**Usage personnel, hors ligne. Aucun compte, aucune publicité, aucun analytics,
aucune donnée envoyée nulle part. Ce projet n'est pas destiné à être publié sur
l'App Store.**

---

## 1. Démarrage rapide

```bash
npm install
npm run dev          # http://localhost:5173
```

Pour tester sur l'iPhone pendant le développement, le serveur écoute déjà sur le
réseau local : ouvrez `http://<ip-de-votre-mac>:5173` dans Safari.

```bash
npm run build        # vérification des types + build de production dans dist/
npm run preview      # sert dist/ sur le réseau local
```

## 2. Installer le jeu sur l'iPhone

1. Ouvrez l'adresse du jeu dans **Safari** (pas Chrome : seul Safari sait
   installer une PWA sur iOS).
2. Touchez le bouton **Partager** (le carré avec une flèche vers le haut).
3. Choisissez **« Sur l'écran d'accueil »**.
4. Validez : une icône « RagZayn » apparaît, avec le mannequin jaune.

Lancé depuis cette icône, le jeu s'ouvre en plein écran, sans barre d'adresse,
verrouillé en portrait, et **fonctionne sans connexion** une fois la première
partie chargée (service worker + cache complet).

> Astuce : la première fois, laissez la page se charger complètement (quelques
> secondes) avant de couper le réseau — c'est à ce moment que tout est mis en cache.

## 3. Personnaliser Zayn

Tout l'aspect du héros est décrit dans **`public/config/hero.json`**. Le fichier
est lu au démarrage : il n'y a rien à recompiler, il suffit de recharger la page
(en PWA installée, fermez puis rouvrez l'app deux fois pour rafraîchir le cache).

| Champ | Rôle |
|---|---|
| `name` | Prénom, utilisé dans les textes |
| `age` | Pilote les proportions : `2` donne les proportions d'un bambin (grosse tête, membres courts, ventre rond) |
| `skinTone` | Couleur de peau (hex) |
| `hairColor`, `hairStyle` | `short_textured`, `short_flat`, `curly`, `buzz`, `none` |
| `eyeColor`, `eyeShape` | `round_large`, `round_small`, `almond` |
| `expression` | `big_smile`, `smile`, `neutral`, `excited` |
| `outfit.top` | `tshirt` / `longsleeve` / `hoodie`, couleur, manches, motif de poitrine |
| `outfit.bottom` | `shorts` / `pants` + couleur |
| `outfit.shoes` | `sneakers` / `boots` / `barefoot` + couleur |
| `accessories` | Liste optionnelle : `"cap"`, `"glasses"`, `"backpack"` |
| `placement` | Position, orientation et taille du héros dans la scène |
| `voice` | Voix de victoire (voir ci‑dessous) |
| `ui.winTitle` | Texte affiché sur l'écran de victoire |

Le héros n'a **aucun corps physique** : il n'est jamais touché, jamais projeté,
jamais endommagé. La seule cible du jeu est le mannequin de bois.

### Animations

Zayn a quatre états, animés de façon procédurale (aucun fichier à charger) :
repos, visée, lancer/frappe, et célébration (petit saut, bras levés, et il se
retourne vers la caméra pour montrer son sourire).

## 4. La voix « Bravo Zayn ! »

Par défaut, la phrase est prononcée par la **synthèse vocale de l'iPhone**
(Web Speech API), en `fr-FR`, avec une voix féminine si le système en propose une
(recherche de « Amélie », « Audrey », « Aurélie », « female »… puis repli sur la
première voix française disponible). Réglages dans `hero.json` :

```json
"voice": {
  "enabled": true,
  "text": "Bravo Zayn !",
  "lang": "fr-FR",
  "preferredVoiceNames": ["Amélie", "Audrey", "Aurélie", "female"],
  "pitch": 1.1,
  "rate": 0.9,
  "volume": 1.0,
  "audioFile": "audio/bravo-zayn.mp3"
}
```

### Utiliser votre propre voix (recommandé)

Déposez un enregistrement court dans **`public/audio/bravo-zayn.mp3`**, puis
rebuildez. Le jeu détecte le fichier au démarrage et le joue **à la place** de la
synthèse vocale. Voir `public/audio/README.md`.

> Contrainte Safari iOS : le son et la synthèse vocale ne peuvent démarrer
> qu'après un premier contact du doigt sur l'écran. Le jeu les débloque
> automatiquement au premier appui — c'est normal que le tout premier lancement
> soit silencieux jusqu'à ce que l'enfant touche l'écran.

## 5. Les 2 500 niveaux

Les niveaux ne sont pas stockés un par un : ils sont **générés de façon
déterministe** à partir du numéro de niveau (`seed = numéro`). Le niveau 1 736
sera toujours identique, sur n'importe quel appareil.

- **Catalogue d'outils** : `public/config/tools.json` (15 outils — boule de
  bowling, marteau sur pivot, voiture de police suspendue, presse hydraulique,
  canon, explosif, scie circulaire, enclume, piano, rouleau compresseur,
  catapulte, ventilateur géant, plaque électrique, laser, trampoline + mur).
- **Progression** : un nouvel outil est introduit **seul** tous les 10 niveaux
  (niveaux 1, 11, 21, …) pour l'apprentissage.
- **Difficulté** : paliers de 100 niveaux ; distance, masses, gravité, obstacles
  et seuil de dégâts augmentent progressivement.
- **Boss** : tous les 50 niveaux — mannequin renforcé (plus lourd, articulations
  plus résistantes) ou double mannequin.
- **Combinaisons** : 1 à 3 outils par niveau au‑delà des niveaux d'apprentissage.

### Garantie de jouabilité

```bash
npm run validate-levels -- --from 1 --to 2500 --write
```

Chaque niveau est rejoué **en simulation headless** (le même moteur physique que
le jeu, sans rendu) avec un « tir raisonnable » : visée balistique automatique sur
le torse, à trois puissances. Si le seuil de dégâts n'est pas atteignable, une
autre variante de seed est tirée et enregistrée dans
`public/config/level-fixes.json`, que le jeu applique automatiquement.

Résultat de la dernière exécution (`validation-report.json`) :

| | |
|---|---|
| Niveaux testés | **2 500** |
| Finissables | **2 500 (100 %)** |
| Corrigés par variante de seed | 250 |
| Échecs | **0** |
| Dégâts obtenus / seuil (moyenne) | 1,19 |
| Durée | ~41 s |

Les **niveaux 1 à 20** ont en plus été vérifiés un par un avec le tir le plus
simple possible (un simple appui, sans viser) :

```bash
npm run check-first-levels     # 20/20 terminés d'un seul appui
```

### Remplacer un niveau à la main

`public/config/levels-overrides.json` permet d'écraser n'importe quel niveau :

```json
{
  "levels": {
    "7": {
      "damageThreshold": 900,
      "tools": [{ "id": "piano", "primary": true, "position": [0, 4.2, 0], "rotationZ": 0, "massScale": 1 }]
    }
  }
}
```

Les clés fournies remplacent celles du niveau généré ; les autres sont conservées.
Les niveaux ainsi remplacés sont ignorés par la validation automatique.

### Recalibrer les outils

```bash
npm run calibrate-tools -- --write
```

Mesure les dégâts médians réellement infligés par chaque outil et met à jour son
champ `power` dans `tools.json`. C'est ce chiffre qui rend les seuils de dégâts
comparables d'un outil à l'autre. À relancer si vous modifiez les masses, les
tailles ou la physique, puis relancer `validate-levels`.

## 6. Comment on joue

| Type d'outil | Geste |
|---|---|
| Boule, explosif, scie | **Glisser** vers le mannequin puis relâcher |
| Voiture, presse, enclume, piano, rouleau | **Toucher** l'écran pour lâcher |
| Marteau sur pivot | **Maintenir** le doigt appuyé |
| Canon, catapulte | **Glisser** pour viser, relâcher pour tirer |
| Ventilateur, laser, plaque électrique | **Maintenir** le doigt appuyé |

La visée est **automatique** : un simple appui envoie le projectile droit sur le
mannequin. Le glissement sert seulement à dévier le tir et à doser la puissance —
le jeu reste donc jouable par un tout‑petit, tout en laissant de la marge à un
joueur plus adroit. Une trajectoire en pointillés s'affiche pendant la visée.

Le mannequin possède 11 segments (tête, torse, bassin, bras, avant‑bras, cuisses,
tibias) reliés par des articulations sphériques et des charnières à butée. Chaque
articulation a un **seuil de rupture** : au‑delà, le membre se détache et tombe.
Les dégâts cumulent la force des impacts (force × masse) et une prime par membre
arraché. Quand le seuil du niveau est atteint : ralenti d'une seconde, puis écran
« Bravo Zayn ! ».

Si le tir échoue et que tout est retombé, le niveau se réinitialise tout seul —
inutile de savoir lire pour rejouer.

## 7. Déploiement sur GitHub Pages

Le dépôt contient le workflow `.github/workflows/deploy.yml`.

1. Dans **Settings → Pages** du dépôt, réglez **Source** sur **GitHub Actions**.
2. Poussez sur la branche `main` (ou lancez le workflow à la main depuis l'onglet
   **Actions → Deploiement GitHub Pages → Run workflow**).
3. Le jeu est publié sur `https://<votre-compte>.github.io/<nom-du-depot>/`.

Le workflow injecte automatiquement le bon chemin de base
(`BASE_PATH=/<nom-du-depot>/`), vérifie les types, construit le projet et
revalide les 300 premiers niveaux avant de publier.

> Le dépôt peut rester **privé** : GitHub Pages sur dépôt privé nécessite un plan
> payant. Si le dépôt est privé et que vous ne souhaitez pas payer, deux options :
> servir `dist/` depuis n'importe quel hébergeur statique, ou simplement ouvrir
> `npm run preview` depuis votre Mac quand l'enfant joue à la maison.

## 8. Structure du projet

```
public/
  config/            hero.json, tools.json, levels-overrides.json, level-fixes.json
  audio/             emplacement du bravo-zayn.mp3 optionnel
  icons/             icônes PWA générées (npm run make-icons)
  manifest.webmanifest, sw.js
src/
  core/              Game, Simulation, PhysicsWorld, Effects, ballistics
  entities/          RagdollFactory, ToolFactory, HeroController
  levels/            LevelGenerator, LevelManager, rng
  render/            SceneView (Three.js)
  systems/           DamageSystem, InputController, AudioManager, VoiceManager, SaveManager
  ui/                UIManager, ui.css
scripts/
  validate-levels.ts      simulation headless des 2 500 niveaux
  calibrate-tools.ts      mesure la puissance réelle de chaque outil
  check-first-levels.ts   vérifie les niveaux 1 à 20 d'un simple appui
  make-icons.ts           génère les PNG des icônes
```

La simulation (`src/core`, `src/entities`, `src/systems/DamageSystem`) ne dépend
pas de Three.js : c'est ce qui permet de rejouer exactement les mêmes niveaux
dans Node pour la validation.

## 9. Scripts npm

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Types + build de production |
| `npm run preview` | Sert `dist/` sur le réseau local |
| `npm run typecheck` | Vérification TypeScript seule |
| `npm run validate-levels -- --write` | Valide et corrige les 2 500 niveaux |
| `npm run check-first-levels` | Vérifie les niveaux 1 à 20 |
| `npm run calibrate-tools -- --write` | Recalibre la puissance des outils |
| `npm run make-icons` | Régénère les icônes PWA |

## 10. Notes techniques

- **Vite + TypeScript strict**, **Three.js** pour le rendu, **Rapier**
  (`@dimforge/rapier3d-compat`) pour la physique.
- Cible **Safari iOS 17+**, portrait uniquement, `safe-area` gérée, pixel ratio
  plafonné pour tenir 60 fps.
- Sons **entièrement synthétisés** en Web Audio (impacts, craquements de bois,
  explosion, ambiance) : aucun fichier audio à télécharger.
- Le paquet JavaScript est volumineux (~3,4 Mo, ~1,2 Mo compressé) parce que le
  moteur physique WebAssembly est embarqué en base64 dans la variante `compat`.
  C'est téléchargé **une seule fois**, puis servi depuis le cache.
- Progression sauvegardée en `localStorage` (niveau courant, meilleur niveau,
  records de dégâts, réglages).
- Réglages accessibles par l'icône engrenage : sons, voix, vibrations, sélecteur
  de niveaux (pagination par 100 + saut direct par numéro), remise à zéro.
- `window.__game.loadLevel(n)` dans la console permet de sauter à un niveau
  pendant le développement.
