// Owner: Orchestrator. Composition root only — no logic here.
import { GlassFilters } from "./design/GlassFilters";
import { Island } from "./shell/Island";

export default function App() {
  return (
    <>
      <GlassFilters />
      <Island />
    </>
  );
}
