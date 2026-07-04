import { create } from "zustand";

export type SessionFindTarget = {
  sessionId: string;
  messageId?: string;
};

type OpenFindOptions = {
  query?: string;
  target?: SessionFindTarget;
};

type SessionFindStore = {
  open: boolean;
  query: string;
  appliedQuery: string;
  target: SessionFindTarget | null;
  focusNonce: number;
  openFind: (opts?: OpenFindOptions) => void;
  setQuery: (query: string) => void;
  setAppliedQuery: (query: string) => void;
  closeFind: () => void;
};

export const useSessionFindStore = create<SessionFindStore>((set) => ({
  open: false,
  query: "",
  appliedQuery: "",
  target: null,
  focusNonce: 0,
  openFind: (opts) => set((state) => {
    const query = opts?.query ?? state.query;
    return {
      open: true,
      query,
      appliedQuery: query,
      target: opts?.target ?? null,
      focusNonce: state.focusNonce + 1,
    };
  }),
  setQuery: (query) => set((state) => (
    state.query === query ? state : { query }
  )),
  setAppliedQuery: (appliedQuery) => set((state) => (
    state.appliedQuery === appliedQuery ? state : { appliedQuery }
  )),
  closeFind: () => set({
    open: false,
    query: "",
    appliedQuery: "",
    target: null,
  }),
}));
