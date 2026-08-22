# Voix de victoire

`bravo-zayn.mp3` contient l'enregistrement utilise par le jeu : c'est lui qui est
joue a chaque « Level Complete », a la place de la synthese vocale de l'iPhone.

## Remplacer l'enregistrement

1. Enregistrez un fichier court (1 a 2 secondes).
2. Nommez-le exactement `bravo-zayn.mp3`.
3. Remplacez le fichier de ce dossier.
4. Relancez `npm run build` (ou poussez, le deploiement s'en charge).

Le fichier est servi « reseau d'abord » par le service worker : un remplacement
est donc pris en compte au prochain lancement avec du reseau, et la derniere
version connue reste jouee hors ligne.

## Revenir a la synthese vocale

Supprimez le fichier. Le jeu detecte son absence au demarrage et prononce
« Bravo Zayn ! » avec une voix francaise du systeme. Le texte et les parametres
de voix sont dans `public/config/hero.json` (section `voice`).
