import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage } from "../../i18n";
import * as ipc from "../../ipc";
import { mockConfig, resetMock } from "../../ipc/mock";
import { resetCaptureStore, runCapture, useCaptureStore } from "../../lib/capture/store";
import { resetAudioStore } from "../../lib/audio/store";
import { resetMediaStore } from "../../lib/media/store";
import { resetIslandStore, useIslandStore } from "../../store";
import { useToastSync } from "../../shell/useShellSync";
import { PillToast } from "../../shell/Island";
import { HomeTab } from "./HomeTab";

beforeEach(()=>{resetMock();resetIslandStore();resetCaptureStore();resetAudioStore();resetMediaStore();});
afterEach(()=>{vi.restoreAllMocks();resetCaptureStore();resetAudioStore();resetMediaStore();});
function Harness(){ useToastSync();const toast=useIslandStore(s=>s.toast);return <><HomeTab/>{toast&&<PillToast {...toast}/>}</>; }

it.each(["ru","en"] as const)("%s exposes five tools, picks HEX with a swatch, and invokes region/qr",async(lang)=>{
  setLanguage(lang);const invoke=vi.spyOn(ipc,"invoke");render(<Harness/>);
  const tools=screen.getByRole("region",{name:lang==="ru"?"Быстрые инструменты":"Quick tools"});
  expect(within(tools).getAllByRole("button")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button",{name:lang==="ru"?"Пипетка":"Color picker"}));
  await waitFor(()=>expect(useCaptureStore.getState().busy).toBe(false));
  expect(invoke).toHaveBeenCalledWith("capture_pick_color");
  expect(screen.getByRole("status")).toHaveTextContent("#336699");
  expect(screen.getByRole("status").querySelector(".ig-pill-color")).toHaveStyle({backgroundColor:"#336699"});
  fireEvent.click(screen.getByRole("button",{name:lang==="ru"?"QR-код":"QR code"}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith("capture_start",{mode:"region",action:"qr"}));
  await screen.findByRole("button",{name:lang==="ru"?"Открыть":"Open"});
  expect(screen.getByRole("status")).toHaveTextContent(lang==="ru"?"QR скопирован":"QR copied");
});

it.each([
  ["https://example.com/ccott",true],["http://example.com/ccott",true],
  ["javascript:alert(1)",false],["file:///C:/test.exe",false],["data:text/html,test",false],["mailto:a@b.com",false],["plain text",false],
] as const)("offers Open only for HTTP(S): %s",async(text,allowed)=>{
  const open=vi.spyOn(window,"open").mockReturnValue(null);
  mockConfig.qrText=text;render(<Harness/>);
  await act(()=>runCapture("region","qr"));
  const status=screen.getByRole("status");
  const button=within(status).queryByRole("button",{name:"Открыть"});
  expect(!!button).toBe(allowed);
  if(button){fireEvent.click(button);await waitFor(()=>expect(open).toHaveBeenCalledWith(new URL(text).href,"_blank","noopener,noreferrer"));}
  else expect(open).not.toHaveBeenCalled();
});
it.each(["ru","en"] as const)("%s reports QR not found and preserves feedback on cancel",async(lang)=>{
  setLanguage(lang);mockConfig.captureOutcome="empty";render(<Harness/>);
  await act(()=>runCapture("region","qr"));
  expect(screen.getByRole("status")).toHaveTextContent(lang==="ru"?"QR-код не найден":"No QR code found");
  expect(within(screen.getByRole("status")).queryByRole("button")).toBeNull();
  mockConfig.captureOutcome="cancel"; const previous=useIslandStore.getState().toast;
  fireEvent.click(screen.getByRole("button",{name:lang==="ru"?"Пипетка":"Color picker"}));
  await waitFor(()=>expect(useCaptureStore.getState().busy).toBe(false));
  expect(useIslandStore.getState().toast).toBe(previous);
});
