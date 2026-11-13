import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OcrLanguagePicker } from "./OcrLanguagePicker";

const languages = [
  { tag: "en-US", name: "English (United States)" },
  { tag: "ru", name: "Русский" },
];

it("opens inside the island and commits a language with the keyboard", () => {
  const onChange = vi.fn();
  render(<OcrLanguagePicker value="auto" languages={languages} onChange={onChange} />);
  const picker = screen.getByRole("combobox");
  expect(picker).toHaveAttribute("data-island-keyboard", "true");
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  const options = within(screen.getByRole("listbox")).getAllByRole("option");
  expect(options[0]).toHaveFocus();
  fireEvent.keyDown(options[0], { key: "ArrowDown" });
  expect(options[1]).toHaveFocus();
  fireEvent.keyDown(options[1], { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("en-US");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(picker).toHaveFocus();
});

it("Escape closes the menu without changing settings or propagating to the shell", () => {
  const onChange = vi.fn();
  const shellKeyDown = vi.fn();
  render(<div onKeyDown={shellKeyDown}><OcrLanguagePicker value="ru" languages={languages} onChange={onChange} /></div>);
  fireEvent.click(screen.getByRole("combobox"));
  const selected = screen.getByRole("option", { name: "Русский" });
  expect(selected).toHaveFocus();
  fireEvent.keyDown(selected, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(shellKeyDown).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps an unavailable saved tag visible and lets the user return to System", () => {
  const onChange = vi.fn();
  render(<OcrLanguagePicker value="de-DE" languages={[]} onChange={onChange} />);
  const picker = screen.getByRole("combobox");
  expect(picker).toHaveTextContent("de-DE");
  fireEvent.click(picker);
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.click(screen.getByRole("option", { name: "Как в Windows" }));
  expect(onChange).toHaveBeenCalledWith("auto");
});
