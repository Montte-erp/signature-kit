import { expect, it } from "vitest";
import { Message as HomeDemoMessage, homeDemoInit, homeDemoUpdate } from "./home-demo";

it("updates document selection and generation requests independently", () => {
  const initial = homeDemoInit();
  const previous = homeDemoUpdate(initial, HomeDemoMessage.PreviousRequested()).model;
  expect(previous.active).toBe(3);
  const next = homeDemoUpdate(previous, HomeDemoMessage.NextRequested()).model;
  expect(next.active).toBe(0);
  const selected = homeDemoUpdate(next, HomeDemoMessage.DocumentSelected({ index: 2 })).model;
  const marked = homeDemoUpdate(selected, HomeDemoMessage.MarkRequested());
  expect(marked.model).toEqual({ active: 2, request: 1, marked: true });
  expect("commands" in marked && marked.commands).toHaveLength(1);
  const reset = homeDemoUpdate(marked.model, HomeDemoMessage.ResetRequested());
  expect(reset.model).toEqual({ active: 2, request: 2, marked: false });
  expect("commands" in reset && reset.commands).toHaveLength(1);
});
