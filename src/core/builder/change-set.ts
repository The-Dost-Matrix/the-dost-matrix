export type ChangeOperation =
  | "create"
  | "replace"
  | "delete";

export interface FileChange {
  path: string;
  operation: ChangeOperation;
  content: string;
}

export interface ChangeSet {
  summary: string;
  changes: FileChange[];
}