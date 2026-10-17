---
name: slipping-regulars
description: Find regulars whose attendance is slipping, from Mindbody report exports (Attendance without Revenue, optionally Autopay Detail and Membership), using the mindbody-attendance-trends tools. Use when someone asks who has stopped coming, whose visits dropped, or wants a check-in list from Mindbody exports.
---

# Slipping regulars from Mindbody exports

The exports hold member names and visit history. Work only through this plugin's tools. Do not open, read, grep,
or print the export files or the report page yourself; the plugin's hook blocks that, and it would put member
data into the chat.

## Steps

1. Ask where the exports are saved. You need:
   - **Attendance without Revenue**, last 3 months (one file, or several monthly files; overlaps are fine).
   - Optional: **Autopay Detail** filtered to Suspended (members on hold get left out).
   - Optional: **Membership (New Version)** (only active members are kept).
   If they have not exported yet, give them the steps in "How to export" below.
2. Call `load_exports` with `paths` (attendance), and `hold_paths` / `membership_paths` if given.
   Report back plainly: rows read, members, date range, weeks covered, duplicates removed.
   - If a file says `needs_mapping`, show the user the listed header names and ask which one holds the
     missing field, then call `map_columns`. Never guess from row contents; you are only given header names.
   - If `gaps_between_files` is not empty, a month is probably missing. Say so before going on.
   - If `status_column_found` is false, every row is counted as a visit. Say so.
3. Call `slipping_regulars`. It returns codes like `M-0147` and numbers. Summarize the counts and the pattern
   (how many, how big the drops are). Do not invent names for codes.
4. Call `open_report` (pass `facility_name` if the user gave one) so the user sees names in their browser.
   Tell them the page is on their computer and nothing was uploaded.

## Notes

- Names reach Claude only if the user turned on `share_names_with_claude` in the plugin or extension settings.
  If tool results contain names, the user chose that; still do not repeat more than needed.
- The rule: Monday-based weeks; a regular attended in at least 6 of 8 usual weeks and averaged 2 or more days a
  week; slipping means the last 3 weeks averaged 60% of usual or less and the latest week was also 60% or less.
  The data date's week counts only if the data date is a Saturday or Sunday. Thresholds can be changed with
  `min_weeks_attended`, `min_usual_per_week` and `drop_ratio`.
- This list is a prompt for a friendly check-in by staff, not a prediction. Do not draft messages that claim to
  know why someone stopped coming.

## How to export (Mindbody)

Insights > Reports, search "Attendance without Revenue". Set the date range to the last 3 months, include all
service categories, Generate, then Export to Excel or CSV. If it times out, run three monthly exports instead.
