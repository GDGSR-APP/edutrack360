import { withAuthenticatedContext } from "./db";

export interface Grade {
  id: string;
  studentCode: string;
  unitId: string;
  classId: string;
  subjectId: string;
  periodId: string;
  gradeValue: number;
  gradeScale: number;
}

/*
 * Seul point d'entree pour lire des notes depuis le reste du code
 * applicatif. Interroge v_grades (vue, migration 9), jamais la table
 * grades directement - app_role n'a de toute facon aucun grant sur la
 * table de base (A1).
 *
 * Prend un userId, jamais une liste d'unites : l'appelant ne peut pas
 * elargir son propre perimetre en passant un argument different -
 * withAuthenticatedContext relit les unites autorisees depuis la base.
 */
export async function getGradesForUser(userId: string): Promise<Grade[]> {
  return withAuthenticatedContext(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, student_code, unit_id, class_id, subject_id, period_id,
              grade_value, grade_scale
       FROM v_grades`
    );
    return rows.map((row) => ({
      id: row.id,
      studentCode: row.student_code,
      unitId: row.unit_id,
      classId: row.class_id,
      subjectId: row.subject_id,
      periodId: row.period_id,
      gradeValue: Number(row.grade_value),
      gradeScale: Number(row.grade_scale),
    }));
  });
}
