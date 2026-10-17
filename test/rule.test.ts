import { describe, expect, it } from "vitest";
import { monday, slippingRegular, twelveMondays, weeklyVisits12w } from "../src/rule.js";
import { visitDays } from "./helpers.js";

// 12 weeks, oldest first; the last is the week of the data date.
const usualThenDrop = [9, 3, 3, 2, 3, 3, 2, 3, 3, 1, 1, 0];

describe("slippingRegular", () => {
  it("flags a regular whose last 3 full weeks fell to 60% of their usual or less", () => {
    // Saturday: the data date's week counts.
    expect(slippingRegular(usualThenDrop, "2026-10-10")).toBe(true);
    expect(slippingRegular([9, 3, 3, 2, 3, 3, 2, 3, 3, 2, 2, 2], "2026-10-10")).toBe(false);
  });

  it("leaves out the data date's week until it reaches Saturday", () => {
    // Wednesday: the last 3 are weeks 8-10. Counting the partial week 11 (0) would wrongly flag this member.
    expect(slippingRegular([3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 3, 0], "2026-10-07")).toBe(false);
    expect(slippingRegular([3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 0, 9], "2026-10-07")).toBe(true);
    // Sunday counts too.
    expect(slippingRegular(usualThenDrop, "2026-10-11")).toBe(true);
  });

  it("needs a real habit: most weeks and about twice a week", () => {
    expect(slippingRegular([0, 4, 4, 0, 4, 0, 4, 4, 0, 0, 0, 0], "2026-10-10")).toBe(false); // only 5 of 8 weeks
    expect(slippingRegular([0, 1, 2, 1, 2, 1, 2, 1, 2, 0, 0, 0], "2026-10-10")).toBe(false); // under 2 a week
  });

  it("does not read unknown weeks as a drop", () => {
    expect(slippingRegular([null, null, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0], "2026-10-10")).toBe(false);
    expect(slippingRegular([3, 3, 3, 3, 3, 3, 3, 3, 3, null, 0, 0], "2026-10-10")).toBe(false);
    expect(slippingRegular(null, "2026-10-10")).toBe(false);
  });

  it("needs both the 3-week average and the latest week at or under the ratio", () => {
    // Usual 3.0, limit 1.8. Average (0+0+2)/3 = 0.67 is low, but the latest week (2) is above 1.8.
    expect(slippingRegular([3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 2], "2026-10-10")).toBe(false);
    // Exactly at the limit counts: usual 2.5, limit 1.5; weeks 1.5 average and latest 1.5 cannot happen with
    // whole days, so use usual 5 (limit 3): last 3 = 3, 3, 3.
    expect(slippingRegular([5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3], "2026-10-10")).toBe(true);
  });

  it("takes custom thresholds", () => {
    const weeks = [3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2]; // last 3 at 67% of usual
    expect(slippingRegular(weeks, "2026-10-10")).toBe(false);
    expect(slippingRegular(weeks, "2026-10-10", { minWeeksAttended: 6, minUsualPerWeek: 2, dropRatio: 0.7 })).toBe(true);
    expect(slippingRegular(usualThenDrop, "2026-10-10", { minWeeksAttended: 6, minUsualPerWeek: 3, dropRatio: 0.6 })).toBe(false);
  });
});

describe("weeklyVisits12w", () => {
  it("counts days attended per Monday-based week, oldest first", () => {
    expect(monday("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(twelveMondays("2026-10-10")[0]).toBe("2026-07-20");
    expect(weeklyVisits12w(visitDays(usualThenDrop), "2026-10-10")).toEqual([7, 3, 3, 2, 3, 3, 2, 3, 3, 1, 1, 0]);
  });

  it("counts a day once even if the member came twice", () => {
    expect(weeklyVisits12w(["2026-10-05", "2026-10-05", "2026-10-06"], "2026-10-10")?.[11]).toBe(2);
  });

  it("ignores visits after the data date", () => {
    expect(weeklyVisits12w(["2026-10-08", "2026-10-09"], "2026-10-08")?.[11]).toBe(1);
  });

  it("marks weeks that start before the exports begin as unknown", () => {
    const weeks = weeklyVisits12w(["2026-08-04"], "2026-10-10", "2026-08-01")!;
    expect(weeks.slice(0, 2)).toEqual([null, null]); // Jul 20, Jul 27
    expect(weeks[2]).toBe(1); // week of Aug 3
    // A file that starts mid-week (Wed Jul 29) cannot vouch for the week of Jul 27 either.
    expect(weeklyVisits12w([], "2026-10-10", "2026-07-29")!.slice(0, 3)).toEqual([null, null, 0]);
  });
});
