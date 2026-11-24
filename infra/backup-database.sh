#!/usr/bin/env sh
# Sauvegarde logique complete (schema + donnees) de la base applicative.
#
# DOIT etre execute avec une connexion SUPERUTILISATEUR ou BYPASSRLS -
# verifie empiriquement (docs/phase5/notes-phase5.md) : edutrack_schema_owner
# (proprietaire des tables mais sans BYPASSRLS) fait ECHOUER tout le dump
# avec une erreur explicite ("query would be affected by row-level
# security policy"), parce que FORCE ROW LEVEL SECURITY s'applique a lui
# aussi. C'est un echec bruyant, pas une sauvegarde silencieusement
# incomplete - mais ca signifie qu'un identifiant superutilisateur est
# necessaire ici, jamais edutrack_schema_owner.
#
# Usage : ./backup-database.sh <DATABASE_URL_SUPERUSER> <chemin_sortie.dump>

set -eu

if [ $# -ne 2 ]; then
  echo "Usage: $0 <DATABASE_URL_SUPERUSER> <chemin_sortie.dump>" >&2
  exit 1
fi

DATABASE_URL="$1"
OUTPUT_PATH="$2"

pg_dump --format=custom --file="$OUTPUT_PATH" "$DATABASE_URL"

echo "Sauvegarde ecrite : $OUTPUT_PATH"
