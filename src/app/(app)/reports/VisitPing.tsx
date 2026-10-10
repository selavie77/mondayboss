"use client";

import { useEffect } from "react";
import { recordVisit } from "./prefs-actions";

/** Records that the report was opened, so the Reports Center can show "Last visited". */
export function VisitPing({ reportKey }: { reportKey: string }) {
  useEffect(() => {
    void recordVisit(reportKey);
  }, [reportKey]);
  return null;
}
