export const photoKinds = [
  "front",
  "back",
  "closeup",
  "paper",
  "returned_front",
  "returned_back",
  "returned_closeup",
] as const;
export type PhotoKind = (typeof photoKinds)[number];
export const photoLabels: Record<PhotoKind, string> = {
  front: "Front",
  back: "Back",
  closeup: "Condition closeup",
  paper: "Paper exam (staff only)",
  returned_front: "Returned front",
  returned_back: "Returned back",
  returned_closeup: "Returned condition closeup",
};
export const scoreFields = [
  "centering",
  "surface",
  "edges",
  "corners",
] as const;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const photoHelp =
  "JPEG, PNG or WebP, up to 4 MiB and 24 megapixels. HEIC/HEIF, RAW, GIF, PDF and SVG are not supported. Export as JPEG or set your camera to Most Compatible. Photos are oriented automatically; location metadata is removed.";
export type ExamFields = {
  centering: number | null;
  surface: number | null;
  edges: number | null;
  corners: number | null;
  notes: string;
  projected_grade: string;
  unable_to_estimate: boolean;
};
export const blankExam: ExamFields = {
  centering: null,
  surface: null,
  edges: null,
  corners: null,
  notes: "",
  projected_grade: "",
  unable_to_estimate: false,
};
export type ExamPhoto = {
  id: string;
  kind: PhotoKind;
  ready: boolean;
  active: boolean;
  width: number | null;
  height: number | null;
  confirmed_at: string | null;
};
export type ExamDraft = {
  version: number;
  fields: ExamFields;
  internal_notes: string;
  updated_at: string | null;
  updated_by: string | null;
};
export type ExamRevision = ExamFields & {
  id: string;
  revision: number;
  draft_version: number;
  signed_by: string;
  signed_at: string;
  description: string;
  photos: ExamPhoto[];
};
export type ExamWorkspace = {
  card_id: string;
  description: string;
  writer: boolean;
  examiner_id: string | null;
  voided: boolean;
  draft: ExamDraft | null;
  photos: ExamPhoto[];
  revisions: ExamRevision[];
  revision_reasons?: Record<string, string>;
  photos_complete: boolean;
  fixture?: boolean;
};
export function examProblems(fields: ExamFields, photos: ExamPhoto[]) {
  const problems: string[] = [];
  for (const kind of ["front", "back"] as const)
    if (!photos.some((p) => p.kind === kind && p.ready && p.active))
      problems.push(`${photoLabels[kind]} photo confirmed in storage`);
  for (const field of scoreFields)
    if (
      !Number.isInteger(fields[field]) ||
      (fields[field] ?? 0) < 1 ||
      (fields[field] ?? 11) > 10
    )
      problems.push(`${field[0].toUpperCase() + field.slice(1)} score (1–10)`);
  if (!fields.unable_to_estimate && !fields.projected_grade.trim())
    problems.push("Projected grade or Unable to estimate");
  return problems;
}
