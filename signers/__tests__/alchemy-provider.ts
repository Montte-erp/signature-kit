import { Effect } from "effect";

const noopPlanStatusSession = {
  emit: () => Effect.void,
  done: () => Effect.void,
  note: () => Effect.void,
};

export const reconcileResourceProps = <Props>(id: string, props: Props) => ({
  id,
  instanceId: `${id}-instance`,
  news: props,
  olds: undefined,
  output: undefined,
  session: noopPlanStatusSession,
  bindings: [],
});
