import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { setLanguage } from "../../i18n";
import { resetTextStore, useTextStore } from "../../lib/text/store";
import { generateQr, MAX_QR_BYTES } from "../../lib/qr/generate";
import { TextTab } from "./TextTab";
beforeEach(()=>{resetTextStore();useTextStore.getState().markPrefilled();});
it.each(["ru", "en"] as const)("%s keeps QR in the format grid with a compact whitespace label", lang => {
  setLanguage(lang);
  render(<TextTab />);
  const qr = screen.getByRole("button", { name: lang === "ru" ? "QR-код" : "QR code" });
  const format = screen.getByRole("button", { name: lang === "ru" ? "JSON красиво" : "Format JSON" });
  expect(qr.parentElement).toHaveClass("tx-grid");
  expect(qr.parentElement).toBe(format.parentElement);
  expect(screen.getByRole("button", { name: lang === "ru" ? "Сжать пробелы" : "Squeeze spaces" })).toBeInTheDocument();
});
it.each(["ru","en"] as const)("%s generates QR from the selection and closes without changing user text", lang => {
  setLanguage(lang);
  useTextStore.getState().edit("prefix CCOTT suffix");
  render(<TextTab/>);
  const area=screen.getByRole("textbox") as HTMLTextAreaElement;
  area.setSelectionRange(7,12);
  fireEvent.click(screen.getByRole("button",{name:lang === "ru" ? "QR-код" : "QR code"}));
  const panel=screen.getByRole("region",{name:lang === "ru" ? "QR-код" : "QR code"});
  expect(within(panel).getByRole("img")).toHaveAttribute("src",generateQr("CCOTT").dataUrl);
  expect(within(panel).getByRole("button",{name:lang === "ru" ? "Копировать картинку" : "Copy image"})).toBeEnabled();
  fireEvent.click(within(panel).getByRole("button",{name:lang === "ru" ? "Закрыть" : "Close"}));
  expect(screen.getByRole("textbox")).toHaveValue("prefix CCOTT suffix");
});
it("shows the length error while keeping text editable",()=>{
  useTextStore.getState().edit("a".repeat(MAX_QR_BYTES+1));render(<TextTab/>);
  fireEvent.click(screen.getByRole("button",{name:"QR-код"}));
  expect(screen.getByRole("alert")).toHaveTextContent("1800");expect(screen.getByRole("textbox")).toBeEnabled();
});
