import * as React from "react";

type SyncStoreListener = () => void;

export type SyncStore<State> = {
  readonly getSnapshot: () => State;
  readonly subscribe: (listener: SyncStoreListener) => () => void;
  readonly setState: (update: (state: State) => State) => void;
};

export const createSyncStore = <State>(initialState: State): SyncStore<State> => {
  const cell = { state: initialState };
  const listeners = new Set<SyncStoreListener>();
  const publish = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => cell.state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (update) => {
      const next = update(cell.state);
      if (Object.is(next, cell.state)) return;
      cell.state = next;
      publish();
    },
  };
};

export const useSyncStore = <State, Selected>(
  store: SyncStore<State>,
  selector: (state: State) => Selected,
): Selected =>
  React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
