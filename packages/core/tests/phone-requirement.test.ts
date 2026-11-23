import { describe, expect, it } from "vitest";
import { phoneRequirement } from "../src/phone-requirement.js";

describe("local required phone", () => {
  it.each([
    "777123456",
    "777 123 456",
    "+420 777 123 456",
    "+420777123456",
    "00420 777 123 456",
    "420777123456",
    "(+420) 777-123-456",
    "777/123/456",
    "777.123.456",
    "+420 777 123 456",
    " 602 123 456 ",
    "222 333 444",
    "+421 905 123 456",
    "00421905123456",
    "421905123456",
    "0905 123 456",
    "02 1234 5678",
    "+49 30 1234567",
    "+44 20 7946 0958",
    "+1 (212) 555-1234",
    "+43 1 234567",
  ])("accepts %j, also unformatted", (value) => {
    expect(phoneRequirement(value)).toBeNull();
  });

  it.each(["", "   ", "+", "+4", "+42", "+420", "+420 "])("asks to fill in %j", (value) => {
    expect(phoneRequirement(value)).toBe("phone.required");
  });

  it.each(["jana.novakova@seznam.cz", "jana@", " +420 jana@example.com"])(
    "points out an e-mail in the phone field: %j",
    (value) => {
      expect(phoneRequirement(value)).toBe("phone.email");
    },
  );

  it.each([
    "77712345",
    "7771234567",
    "777 123",
    "+420 777 123 45",
    "+420 777 123 4567",
    "+420 0905 123 456",
    "+421 905 123",
    "+12345",
    "+0 123 456 789",
    "123",
    "nemám",
    "777 123 456 Jana",
    "777123456 ext. 12",
    "+420 777 123 456, +420 608 111 222",
    "777+123456",
    "-",
  ])("rejects %j", (value) => {
    expect(phoneRequirement(value)).toBe("phone.invalid");
  });

  it("stays self-contained for the hosted script", () => {
    const rebuilt = new Function(`return (${phoneRequirement.toString()})`)() as (
      value: string,
    ) => string | null;
    expect(rebuilt("+420 777 123 456")).toBeNull();
    expect(rebuilt("jana@example.com")).toBe("phone.email");
  });
});
