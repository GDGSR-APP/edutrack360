#!/usr/bin/env sh
# Restauration d'une sauvegarde logique (format custom pg_dump).
#
# Procedure OBLIGATOIRE, dans cet ordre - verifiee empiriquement
# (docs/phase5/notes-phase5.md) :
#   1. infra/bootstrap-roles.sql DOIT avoir deja ete execute sur le
#      cluster cible. La sauvegarde ne contient PAS les roles (pg_dump
#      d'une seule base ne dump jamais les roles, qui sont des objets de
#      CLUSTER, pas de base) - sans cette etape, chaque instruction GRANT
#      de la sauvegarde echoue avec "role ... does not exist" (35 erreurs
#      observees dans le test qui a mene a ce script).
#   2. Ce script restaure ensuite dans une base VIDE et deja creee.
#
# Ne JAMAIS executer ce script contre une base de production sans
# confirmation explicite separee - il n'y a aucune protection technique
# dans ce script contre une cible de production, par conception (le
# directeur de projet choisit la cible, ce script ne la devine pas).
#
# Usage : ./restore-database.sh <DATABASE_URL_CIBLE> <chemin_sauvegarde.dump>

set -eu

if [ $# -ne 2 ]; then
  echo "Usage: $0 <DATABASE_URL_CIBLE> <chemin_sauvegarde.dump>" >&2
  exit 1
fi

DATABASE_URL="$1"
INPUT_PATH="$2"

pg_restore --dbname="$DATABASE_URL" "$INPUT_PATH"

echo "Restauration terminee depuis : $INPUT_PATH"
