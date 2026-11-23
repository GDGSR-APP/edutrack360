# Signalement - etat mesure de la base source Supabase

**Statut : BROUILLON. Non envoye.** Redige a la demande du directeur de
projet ; son envoi au responsable de la base source est son action, pas
celle de cette session. Ce signalement est independant du projet EduTrack360
: il concerne la securite de la base source elle-meme, que ce projet y
accede ou non.

## Constats mesures le 23/11/2026 (lecture seule, aucune modification effectuee)

- **609** droits de table accordes aux roles `anon` et `authenticated` sur le
  schema `public`, dont **348** en ecriture (INSERT, UPDATE, DELETE,
  TRUNCATE).
- **33 tables sans aucune politique RLS active**, parmi lesquelles les notes,
  les moyennes officielles, les seuils de reussite, et les referentiels
  eleves.
- **14 fonctions `SECURITY DEFINER`** appartenant a un superutilisateur, dont
  **12** executables par le role `authenticated`.
- Le **service de metadonnees** de cette base repond **sans identification**
  depuis le reseau interne et **execute du SQL avec les privileges du
  superutilisateur**.
- Une **route d'administration de la passerelle** avait ete exposee sans
  protection ; elle est **desormais fermee**.

## Pourquoi ce signalement

Ces constats depassent le perimetre d'EduTrack360 (qui ne demande, via le
document d'autorisation separe, qu'un acces en lecture seule, colonne par
colonne, sur un perimetre tres etroit). Ils exposent la base source a un
risque independamment de ce projet : toute application ou tout utilisateur
disposant deja d'un compte `authenticated` herite potentiellement d'un acces
en ecriture sur 348 droits de table, et d'une execution possible de 12
fonctions a privileges superutilisateur. Le service de metadonnees non
authentifie est, de plus, atteignable sans meme un compte applicatif.

## Ce que ce signalement ne demande pas

- Il ne demande pas de changement immediat lie au projet EduTrack360.
- Il ne remplace pas une revue de securite complete de la base source, qui
  releve du responsable de cette base.

---

*Prochaine etape : revue et envoi par le directeur de projet, au responsable
de la base source. Cette session n'envoie rien.*
