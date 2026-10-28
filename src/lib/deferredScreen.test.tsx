import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, useState, type ComponentType } from "react";
import { expect, it } from "vitest";
import { deferredScreen } from "./deferredScreen";

it("keeps local screen state after a cold load and subsequent parent renders", async () => {
  let resolve = (_module: { default: ComponentType }) => {};
  const deferred = deferredScreen(() => new Promise((ready) => { resolve = ready; }));
  function Editor() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  }
  const view = render(<Suspense fallback={<div>loading</div>}><deferred.Screen /></Suspense>);
  expect(screen.getByText("loading")).toBeInTheDocument();
  await act(async () => resolve({ default: Editor }));
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  view.rerender(<Suspense fallback={<div>loading</div>}><deferred.Screen /></Suspense>);
  expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
});
