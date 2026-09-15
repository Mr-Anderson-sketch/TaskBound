// renderer/lib/dateLabels — locale-day-first date labels (Task 4.1 fix round 1, item 2).
// `Intl.DateTimeFormat`'s part ORDER for { weekday, day, month } varies by locale/OS —
// en-US gives "Tuesday, September 15", en-GB gives "Tuesday 15 September" — but the
// planner's Today meta line (ruling 8, DESIGN.md "Planner") always wants the latter
// order regardless of the user's OS locale. `formatToParts` gives us the individual
// weekday/day/month strings (already localised, e.g. a translated weekday name) and we
// reassemble them ourselves in a fixed order, dropping every literal Intl inserts
// (commas, "de", spaces) and joining with a single space.
export function longDayLabel(ms: number, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return [get('weekday'), get('day'), get('month')].filter((s) => s.length > 0).join(' ');
}
