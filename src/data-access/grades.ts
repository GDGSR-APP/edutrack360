import { withUnitContext } from "./db";

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
 */
export async function getGradesForUnits(unitIds: readonly string[]): Promise<Grade[]> {
  return withUnitContext(unitIds, async (client) => {
    const { rows } = await client.query(
      `SELECT id, student_code, unit_id, class_id, subject_id, period_id,
              grade_value, grade_scale
       FROM v_grades
       WHERE unit_id = ANY($1)`,
      [unitIds]
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
