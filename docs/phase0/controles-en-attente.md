# Controles de garde-fou en attente de demonstration reelle

Controles dont le MECANISME est en place (code, hook, config) mais dont le
comportement de BLOCAGE n'a jamais ete observe par execution reelle - a
distinguer d'un controle fonctionnel verifie. Visible pour la relecture
independante de la Phase 6.

| Controle | Mecanisme en place | Ce qui n'a pas ete demontre | Action requise |
|---|---|---|---|
| Blocage d'un commit contenant un secret (critere de validation de la Phase 0) | `.githooks/pre-commit` appelle `gitleaks protect --staged` et bloque le commit (exit 1) si un secret est detecte ; `.gitleaks.toml` configure | `gitleaks` n'est installe sur aucune machine ayant servi a ce depot depuis le debut de la session. Le hook le detecte et degrade explicitement en avertissement (`exit 0`, jamais un blocage silencieux) a chaque commit passe - verifie, mais cela signifie que **le blocage reel n'a jamais ete declenche**. Aucun commit n'a jamais ete refuse par gitleaks ; tous les commits de ce depot ont ete acceptes sous ce mode degrade. | Installation de `gitleaks` par le directeur de projet (pas par cette session - instruction explicite : ne pas le contourner, ne pas l'installer soi-meme). Une fois installe, rejouer un commit contenant un faux secret deliberement et verifier le refus reel avant de considerer ce controle comme demontre. |
