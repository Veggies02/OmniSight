import React, { createContext, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { getDefect, isDefectInjectionEnabled, type DefectDefinition } from "../data/defects";

export interface DefectContextValue {
  activeDefect: DefectDefinition | null;
  activeDefectId: string | null;
  isDefectActive: (defectId: string) => boolean;
  hasDefect: boolean;
  isInjectionEnabled: boolean;
}

const DefectContext = createContext<DefectContextValue>({
  activeDefect: null,
  activeDefectId: null,
  isDefectActive: () => false,
  hasDefect: false,
  isInjectionEnabled: false,
});

export const DefectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams] = useSearchParams();
  const rawDefectParam = searchParams.get("defect");

  const injectionEnabled = useMemo(() => {
    return isDefectInjectionEnabled();
  }, []);

  const activeDefect = useMemo(() => {
    return getDefect(rawDefectParam);
  }, [rawDefectParam]);

  const value = useMemo<DefectContextValue>(() => {
    return {
      activeDefect,
      activeDefectId: activeDefect ? activeDefect.id : null,
      isDefectActive: (id: string) => activeDefect?.id === id,
      hasDefect: activeDefect !== null,
      isInjectionEnabled: injectionEnabled,
    };
  }, [activeDefect, injectionEnabled]);

  return (
    <DefectContext.Provider value={value}>
      {/* Test & RPA Inspection Metadata Container */}
      <div
        id="omnisight-defect-metadata"
        style={{ display: "none" }}
        data-testid="omnisight-defect-metadata"
        data-defect-active={value.hasDefect ? "true" : "false"}
        data-defect-id={value.activeDefectId || "none"}
        data-defect-category={value.activeDefect?.category || "none"}
        data-defect-target={value.activeDefect?.targetComponent || "none"}
        data-defect-route={value.activeDefect?.targetRoute || "none"}
        data-defect-injection-enabled={value.isInjectionEnabled ? "true" : "false"}
        aria-hidden="true"
      />
      {children}
    </DefectContext.Provider>
  );
};

export function useDefect(): DefectContextValue {
  return useContext(DefectContext);
}
