"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import {
  groupNumberInput,
  rawNumberInput,
  numberInputString,
} from "./number-input";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: string | number;
  onValueChange: (raw: string) => void;
};

/** Display grouping while the parent always receives an unformatted numeric value. */
export default function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step,
  ...props
}: Props) {
  const [raw, setRaw] = useState(numberInputString(value));
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useEffect(() => {
    setRaw((current) =>
      value === ""
        ? ""
        : Number(current) === Number(value)
          ? current
          : numberInputString(value),
    );
  }, [value]);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    const formatted = input.current.value;
    let position = 0,
      remaining = caret.current;
    while (position < formatted.length && remaining > 0) {
      if (formatted[position] !== ",") remaining--;
      position++;
    }
    input.current.setSelectionRange(position, position);
    caret.current = null;
  }, [raw]);
  useEffect(() => {
    const amount = Number(raw);
    const invalid =
      raw !== "" &&
      ((min !== undefined && amount < Number(min)) ||
        (max !== undefined && amount > Number(max)));
    input.current?.setCustomValidity(
      invalid ? "입력 가능한 금액 또는 수량 범위를 확인해 주세요." : "",
    );
  }, [raw, min, max]);
  return (
    <input
      {...props}
      ref={input}
      type="text"
      inputMode={step === "1" ? "numeric" : "decimal"}
      value={groupNumberInput(raw)}
      onChange={(event) => {
        let next = rawNumberInput(event.target.value);
        if (next === null) return;
        caret.current = event.target.value
          .slice(0, event.target.selectionStart ?? event.target.value.length)
          .replace(/,/g, "").length;
        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (
          next === raw &&
          event.target.value !== groupNumberInput(raw) &&
          inputType?.startsWith("delete")
        ) {
          const position = Math.max(
            0,
            caret.current - (inputType === "deleteContentBackward" ? 1 : 0),
          );
          next = raw.slice(0, position) + raw.slice(position + 1);
          caret.current = position;
        }
        if (event.target.value.startsWith(".")) caret.current++;
        setRaw(next);
        onValueChange(next);
      }}
    />
  );
}
