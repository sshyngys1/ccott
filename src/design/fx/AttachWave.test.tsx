import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachWaveLayer } from "./AttachWave";
import type { AttachSignal } from "./wave";

const motionMode = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionMode.reduce,
}));

afterEach(() => {
  motionMode.reduce = false;
});

function Island({ added }: { added: AttachSignal | null }) {
  return (
    <div className="ig-glass ig-island">
      <AttachWaveLayer added={added} />
      <section>
        <div data-dock-id="a">
          <button type="button">A</button>
        </div>
        <div data-dock-id="b">
          <button type="button">B</button>
        </div>
      </section>
    </div>
  );
}

describe("AttachWave", () => {
  it("no layer at rest and none for a signal that predates the island", async () => {
    render(<Island added={{ ids: ["a"], seq: 3 }} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("fx-wave")).toBeNull();
  });

  it("a new entry starts one wave, a second attach replaces it, the layer is removed afterwards", async () => {
    const { rerender } = render(<Island added={null} />);
    rerender(<Island added={{ ids: ["a"], seq: 1 }} />);
    const first = await screen.findByTestId("fx-wave");
    expect(first).toHaveClass("fx-wave");
    expect(first).toHaveAttribute("aria-hidden", "true");
    rerender(<Island added={{ ids: ["b"], seq: 2 }} />);
    await waitFor(() => expect(screen.getByTestId("fx-wave")).not.toBe(first));
    expect(screen.getAllByTestId("fx-wave")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId("fx-wave")).toBeNull(), { timeout: 3000 });
    expect(document.querySelector(".fx-wave")).toBeNull();
  });

  it("several new entries → one wave", async () => {
    const { rerender } = render(<Island added={null} />);
    rerender(<Island added={{ ids: ["a", "b"], seq: 1 }} />);
    await screen.findByTestId("fx-wave");
    expect(screen.getAllByTestId("fx-wave")).toHaveLength(1);
  });

  it("reduced motion: no wave, the new icon only cross-fades", async () => {
    motionMode.reduce = true;
    const { rerender } = render(<Island added={null} />);
    rerender(<Island added={{ ids: ["a"], seq: 1 }} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("fx-wave")).toBeNull();
  });
});
