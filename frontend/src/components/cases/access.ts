// What the signed-in member may do with the open case.

import { createContext, useContext } from 'react';
import type { CaseAccess } from '../../api/cases';

export const CaseAccessContext = createContext<CaseAccess>('owner');
export const useCaseAccess = () => useContext(CaseAccessContext);
/** View-only: shared with this member to look at, not change. */
export const useReadOnly = () => useContext(CaseAccessContext) === 'viewer';
