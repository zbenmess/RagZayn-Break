# Voix de victoire (optionnel)

Par defaut, « Bravo Zayn ! » est prononce par la synthese vocale de l'iPhone
(Web Speech API, voix francaise feminine si disponible).

Pour utiliser un enregistrement reel a la place, par exemple votre propre voix :

1. Enregistrez un fichier court (1 a 2 secondes).
2. Nommez-le exactement `bravo-zayn.mp3`.
3. Placez-le dans ce dossier (`public/audio/bravo-zayn.mp3`).
4. Relancez `npm run build` (ou redeployez).

Le jeu detecte le fichier au demarrage et le joue automatiquement a la place de
la synthese. Le chemin est configurable dans `public/config/hero.json`
(`voice.audioFile`).
