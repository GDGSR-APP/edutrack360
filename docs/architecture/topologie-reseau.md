# Topologie reseau (Phase 0)

Statut : conception actee, **pas encore deployee**. Le deploiement reel des
reseaux Docker se fait sur le VPS/Coolify, hors de portee de cette session de
travail (pas d'acces SSH/Coolify depuis cet environnement). Ce document est le
cahier des charges a executer par le directeur de projet (ou une session avec
acces au VPS), et la reference pour le test de connectivite negatif.

## Composants et reseaux

| Composant | Nature | Reseau Docker | Duree de vie |
|---|---|---|---|
| Portail (API + UI) | Service permanent | `reseau-portail` | Permanent |
| Base applicative (Postgres) | Conteneur dedie, gere par Coolify | `reseau-portail` | Permanent |
| ETL | **Job ponctuel, pas un service** | `reseau-etl` (dedie, distinct de `reseau-portail`) | Demarre a l'heure planifiee, s'arrete a la fin du run. Jamais "up" en continu. |
| Store de correspondance pseudonymisation | Conteneur/volume dedie | `reseau-etl` uniquement | Permanent, mais joignable seulement pendant un run ETL |
| Supabase source (pile existante) | Hors de notre controle | reseau externe/distant, jamais notre `reseau-portail` ni notre `reseau-etl` en permanence | Existe deja, tourne en continu (y compris son service de metadonnees non authentifie, cf. document de signalement) |

## Principe (point 1)

L'ETL est le seul composant qui touche les trois mondes : la Supabase source,
la base applicative, et le store de correspondance. C'est le point le plus
sensible de la topologie - **precisement pourquoi il n'est pas un service
permanent et n'est jamais sur le reseau du portail.**

- L'ETL s'execute comme **job ponctuel** (conteneur ephemere, declenche par une
  tache planifiee Coolify), jamais comme service `always-on`.
- Son reseau Docker (`reseau-etl`) est distinct de `reseau-portail`. Aucun
  conteneur du portail n'est attache a `reseau-etl`, et reciproquement l'ETL
  n'est attache a `reseau-portail` que le temps d'ecrire dans la base
  applicative (ou via une interface reseau dediee limitee a ce seul flux,
  a preciser au moment du deploiement reel).
- Le store de correspondance pseudonymisation vit uniquement sur `reseau-etl`.
  Le role `app_role` n'a ni grant ni route reseau vers lui.

## Test de connectivite negatif (porte de Phase 0, a executer sur le VPS)

Depuis un conteneur attache a `reseau-portail` :

1. Tentative de connexion vers l'hote/port de la Supabase source -> doit
   echouer (timeout ou refus, pas de reponse applicative).
2. Tentative de connexion vers l'hote/port du store de correspondance
   pseudonymisation -> doit echouer.

Les deux sens sont a verifier : ni la source, ni le store de correspondance ne
repondent depuis le reseau du portail (point 1). Ce test n'a pas encore ete
execute - il requiert les reseaux Docker reels sur le VPS, que cette session
ne peut pas creer ni interroger.

## Ce qui reste a faire (hors de portee de cette session)

- Creation reelle de `reseau-portail` et `reseau-etl` sur Coolify.
- Attachement des conteneurs existants/a venir aux bons reseaux.
- Execution effective du test de connectivite negatif ci-dessus et archivage
  du resultat.
