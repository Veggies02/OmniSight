import { useDefect } from "../context/DefectContext";
import type { DefectDefinition } from "../data/defects";

export interface UseDefectReturn {
  activeDefect: DefectDefinition | null;
  activeDefectId: string | null;
  isDefectActive: (defectId: string) => boolean;
  hasDefect: boolean;
}

export function useDefects(): UseDefectReturn {
  return useDefect();
}
