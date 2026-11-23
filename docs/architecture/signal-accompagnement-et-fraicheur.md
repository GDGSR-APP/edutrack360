# Signal d'accompagnement (seuils) et fraicheur des donnees ETL

## Seuils du signal : pas encore definis, pas a inventer (point 3)

`support_capacity_signal`, ainsi que les seuils et la regle de calcul qui le
produisent, sont des regles **pedagogiques**, qui relevent du directeur de
projet et d'une validation metier - pas d'une decision technique de cette
session.

Decision actee en attendant cette validation :

- Le signal est traite comme une **fonction parametrable**, pas comme une
  regle codee en dur.
- Les seuils vivent dans une **table de configuration** en base applicative
  (a definir en Phase 1, structure non encore ecrite), jamais dans le code.
- **Aucune valeur par defaut n'est codee en dur.** Tant que la table de
  configuration n'est pas remplie par une decision metier validee, le calcul
  du signal ne produit pas de resultat substitutif silencieux (pas de "0 par
  defaut", pas de seuil invente) - il doit echouer explicitement ou afficher
  une absence de signal, jamais une valeur inventee presentee comme un
  resultat.
- Rang (`rank`) et effectif (`cohort_size`) restent calculables sans ces
  seuils (ils ne dependent que des notes et des regroupements, §A5) ; seul
  `support_capacity_signal` depend de la table de configuration a valider.

## Fraicheur des donnees (point 4)

Toute page affichant des donnees issues de l'ETL (notes, moyennes, rangs,
signal) porte, de maniere visible, la date du dernier chargement ETL reussi
pour les donnees affichees.

- Raison actee : une liste sans date de fraicheur est lue par le lecteur
  comme l'etat du jour, ce qu'elle n'est pas (les donnees proviennent d'un
  chargement ponctuel, pas d'une lecture en temps reel de la source).
- Implication de schema (Phase 1, pas encore ecrite) : une table ou un
  horodatage technique enregistrant la date/heure du dernier run ETL reussi,
  par unite ou globalement selon la granularite du chargement, exploitable
  par toute page d'affichage.
- Implication UI (Phase 8, pas encore ecrite) : aucune page listant des
  donnees ETL ne s'affiche sans cette date visible - meme regle de presence
  obligatoire que la mention A6 sur les classements.
