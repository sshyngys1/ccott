import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest globals are off, so RTL can't auto-register its cleanup.
afterEach(() => cleanup());
