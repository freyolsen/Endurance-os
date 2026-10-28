import { describe, it, expect } from "vitest";
import {
  duration,
  newStep,
  shift,
  monday,
  dateSchema,
  inputSchema,
} from "../shared/domain";
describe("workout domain", () => {
  it("calculates repeat duration", () => {
    expect(
      duration([
        {
          ...newStep("repeat"),
          count: 5,
          children: [
            { ...newStep(), value: 60 },
            { ...newStep("recovery"), value: 90 },
          ],
        },
      ]).seconds,
    ).toBe(750);
  });
  it("does not invent distance duration", () => {
    expect(
      duration([{ ...newStep(), durationKind: "distance_m", value: 1000 }])
        .seconds,
    ).toBeNull();
    expect(
      duration([
        {
          ...newStep(),
          durationKind: "distance_m",
          value: 1000,
          target: "pace_sec_km",
          min: 240,
          max: 300,
        },
      ]),
    ).toEqual({ seconds: 270, estimated: true });
  });
  it("preserves calendar days over Oslo DST", () => {
    expect(shift("2026-03-29", 1)).toBe("2026-03-30");
    expect(monday("2026-10-25")).toBe("2026-10-19");
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects invalid targets and excessive expansion", () => {
    const base = {
      title: "Test",
      sport: "running",
      description: "",
      intensity: "easy",
      calendarDate: "2026-10-28",
    };
    expect(
      inputSchema.safeParse({
        ...base,
        steps: [{ ...newStep(), target: "rpe", min: 11, max: 12 }],
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        ...base,
        steps: [
          {
            ...newStep("repeat"),
            count: 100,
            children: [{ ...newStep("repeat"), count: 100 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
