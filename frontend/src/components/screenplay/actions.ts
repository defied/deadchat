// What deep components (like a shot's box) need to change server-side media:
// save the document first, then apply the new detail from the server.

import { createContext, useContext } from 'react';
import type { Detail } from '../../api/screenplays';

export interface ScreenplayActions {
  screenplayId: number;
  flush: () => Promise<void>;
  setDetail: (d: Detail) => void;
}

export const ScreenplayActionsContext = createContext<ScreenplayActions | null>(null);

export function useScreenplayActions(): ScreenplayActions {
  const a = useContext(ScreenplayActionsContext);
  if (!a) throw new Error('ScreenplayActionsContext missing');
  return a;
}
