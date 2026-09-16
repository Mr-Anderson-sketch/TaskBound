// core/schema — zod validation for persisted data and dispatched actions.
// Every object schema is `.strict()`: unknown keys are a bug (typo, stale field,
// or a future schema version) and must fail loudly rather than pass silently.
import { z } from 'zod';
import type { Action, Data, DeepPartial, Settings } from './types';

// Mutual, non-distributive `extends` equality check for two types, used below to pin
// zod's inferred output types to the hand-written types in ./types so they cannot
// silently drift apart again (see the settings/patch DeepPartial-vs-ZodRecord mismatch
// this guards against). Wrapping both sides in a tuple `[A] extends [B]` suppresses
// conditional-type distribution over unions (both Action and z.infer<ActionSchema> are
// 21-member unions) and checks real structural assignability in both directions — the
// property that actually matters here. The more common "function-parameter-position"
// equality trick (`(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)`)
// was tried first and rejects this codebase's own correct types: it treats
// `Partial<Pick<Task, ...>> & { plannedSeconds?: number | null }` (task/edit's patch,
// written as an intersection in the brief) as unequal to the structurally identical
// flattened object zod infers, even though each is assignable to the other. A failure
// of the check below is a compile error, not a runtime one.
type AssertEqual<A, B> = [B] extends [A] ? ([A] extends [B] ? true : never) : never;

// --- primitives -------------------------------------------------------

const IdSchema = z.string().min(1);
const YmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const HmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:mm');
const TitleSchema = z.string().min(1).max(200);
const TagsSchema = z.array(z.string().max(40)).max(20);

const DueSchema = z
  .object({
    date: YmdSchema,
    time: HmSchema.optional()
  })
  .strict();

const RuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }).strict(),
  z.object({ kind: z.literal('weekdays') }).strict(),
  z
    .object({
      kind: z.literal('weekly'),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .refine((days) => days.every((d, i) => i === 0 || d > days[i - 1]), 'days must be sorted and unique')
    })
    .strict(),
  z
    .object({
      kind: z.literal('monthly'),
      dayOfMonth: z.number().int().min(1).max(31)
    })
    .strict(),
  z
    .object({
      kind: z.literal('everyN'),
      n: z.number().int().positive(),
      unit: z.enum(['day', 'week']),
      anchor: YmdSchema
    })
    .strict()
]);

const TaskTimerSchema = z
  .object({
    plannedSeconds: z.number().nonnegative().optional(),
    spentSeconds: z.number().nonnegative(),
    runningSince: z.number().optional(),
    pausedAtSuspend: z.number().optional()
  })
  .strict();

const TaskSchema = z
  .object({
    id: IdSchema,
    title: TitleSchema,
    notes: z.string().optional(),
    listId: IdSchema,
    parentId: IdSchema.optional(),
    tags: TagsSchema,
    order: z.number(),
    today: z.boolean(),
    due: DueSchema.optional(),
    snoozedUntil: z.number().optional(),
    recurrence: RuleSchema.optional(),
    timer: TaskTimerSchema.optional(),
    status: z.enum(['open', 'done']),
    completedBy: z.enum(['user', 'timer']).optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().optional()
  })
  .strict();

const ListSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    order: z.number(),
    createdAt: z.number()
  })
  .strict();

const DayRecordSchema = z
  .object({
    date: YmdSchema,
    completed: z.number().int().nonnegative(),
    focusSeconds: z.number().nonnegative(),
    rolledOver: z.number().int().nonnegative(),
    note: z.string().optional(),
    closedAt: z.number().optional(),
    rolloverAppliedAt: z.number().optional()
  })
  .strict();

const EdgeSchema = z.enum(['top', 'bottom']);

const StripPositionSchema = z
  .object({
    x: z.number(),
    y: z.number()
  })
  .strict();

const SettingsSchema = z
  .object({
    theme: z
      .object({
        name: z.enum(['ledger', 'kraft', 'phosphor', 'slate']),
        mode: z.enum(['light', 'dark', 'system'])
      })
      .strict(),
    textSize: z.enum(['S', 'M', 'L']),
    strip: z
      .object({
        enabled: z.boolean(),
        edge: EdgeSchema,
        width: z.number(),
        collapsed: z.boolean(),
        autoHide: z.boolean(),
        clickThrough: z.boolean(),
        opacity: z.number().min(0.4).max(1),
        reserveSpace: z.boolean(),
        hideOverFullscreen: z.boolean(),
        hideFromCapture: z.boolean(),
        menuBarMode: z.boolean(),
        positions: z.record(z.string(), StripPositionSchema)
      })
      .strict(),
    hotkeys: z
      .object({
        capture: z.string(),
        toggleStrip: z.string(),
        completeAdvance: z.string(),
        toggleTimer: z.string(),
        undo: z.string()
      })
      .strict(),
    timer: z
      .object({
        pomodoro: z.boolean(),
        // Task 3.2 fix round 2, item 3: bounded (1..240 minutes = 60..14400 s, the
        // same range `timer/startSession`'s own schema enforces) — an unbounded
        // workMinutes fed straight into a pomodoro session's `seconds` with no
        // reducer-side clamp of its own (unlike timer/addTime).
        workMinutes: z.number().int().min(1).max(240),
        breakMinutes: z.number().int().min(1).max(240),
        // Task 5.1 addendum ruling 4: 0 means "never" (clock.ts only pauses on idle
        // when > 0), so the floor is 0, not 1, unlike the other minute fields here.
        idlePauseMinutes: z.number().int().min(0).max(120),
        awayThresholdMinutes: z.number().int().min(1).max(120),
        defaultPlannedMinutes: z.number().int().min(1).max(240)
      })
      .strict(),
    score: z
      .object({
        enabled: z.boolean(),
        value: z.number()
      })
      .strict(),
    startOnLogin: z.boolean(),
    notifications: z.boolean(),
    reducedMotion: z.enum(['system', 'on', 'off']),
    dataDir: z.string().optional(),
    onboardingDone: z.boolean()
  })
  .strict();

const SettingsPatchSchema = SettingsSchema.deepPartial();

// Keeps the runtime patch schema and the DeepPartial<Settings> type (used by the
// Action union's settings/patch member, see types.ts) from drifting apart again.
const _settingsPatchTypeMatches: AssertEqual<z.infer<typeof SettingsPatchSchema>, DeepPartial<Settings>> = true;
void _settingsPatchTypeMatches;

/** The most tasks a data file may hold. The reducer enforces it too (`task/add` and a
 * recurrence spawn are no-ops at the cap) and an import that would exceed it is
 * rejected up front — so a file over it can only come from outside the app. Loading
 * uses `parseDataForLoad`, which skips this one bound, so such a file is never
 * mistaken for corruption. */
export const MAX_TASKS = 100_000;

export const DataSchema = z
  .object({
    schemaVersion: z.literal(2),
    tasks: z.array(TaskSchema).max(MAX_TASKS),
    lists: z.array(ListSchema),
    days: z.array(DayRecordSchema),
    settings: SettingsSchema,
    meta: z
      .object({
        createdAt: z.number(),
        lastSavedAt: z.number(),
        appVersion: z.string(),
        legacyImportedAt: z.number().optional()
      })
      .strict()
  })
  .strict();

// --- actions ------------------------------------------------------------

const TaskAddSchema = z
  .object({
    type: z.literal('task/add'),
    id: IdSchema,
    now: z.number(),
    title: TitleSchema,
    listId: IdSchema.optional(),
    parentId: IdSchema.optional(),
    tags: TagsSchema.optional(),
    due: DueSchema.optional(),
    recurrence: RuleSchema.optional(),
    plannedSeconds: z.number().optional(),
    today: z.boolean().optional(),
    makeCurrent: z.boolean().optional()
  })
  .strict();

const TaskEditSchema = z
  .object({
    type: z.literal('task/edit'),
    id: IdSchema,
    now: z.number(),
    patch: z
      .object({
        title: TitleSchema.optional(),
        notes: z.string().optional(),
        listId: IdSchema.optional(),
        tags: TagsSchema.optional(),
        due: DueSchema.optional(),
        recurrence: RuleSchema.optional(),
        today: z.boolean().optional(),
        plannedSeconds: z.number().nullable().optional()
      })
      .strict()
  })
  .strict();

const TaskCompleteSchema = z
  .object({
    type: z.literal('task/complete'),
    id: IdSchema,
    now: z.number(),
    by: z.enum(['user', 'timer', 'import']),
    spawnId: IdSchema.optional()
  })
  .strict();

const TaskUncompleteSchema = z
  .object({
    type: z.literal('task/uncomplete'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

const TaskDeleteSchema = z
  .object({
    type: z.literal('task/delete'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

const TaskMoveSchema = z
  .object({
    type: z.literal('task/move'),
    id: IdSchema,
    now: z.number(),
    listId: IdSchema.optional(),
    parentId: IdSchema.nullable().optional(),
    afterId: IdSchema.nullable().optional()
  })
  .strict();

const TaskMakeCurrentSchema = z
  .object({
    type: z.literal('task/makeCurrent'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

const TaskSkipSchema = z
  .object({
    type: z.literal('task/skip'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

const TaskSnoozeSchema = z
  .object({
    type: z.literal('task/snooze'),
    id: IdSchema,
    now: z.number(),
    until: z.number()
  })
  .strict();

const TaskSetTodaySchema = z
  .object({
    type: z.literal('task/setToday'),
    ids: z.array(IdSchema),
    now: z.number(),
    today: z.boolean()
  })
  .strict();

const TimerStartSchema = z
  .object({
    type: z.literal('timer/start'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

// Task 3.2 fix round 1: strictly bounded (unlike TimerAddTimeSchema below, which the
// reducer clamps itself) — a pomodoro session's length is never user-typed free text,
// so rejecting out-of-range values at the IPC boundary is safe and simpler than
// clamping in the reducer.
const TimerStartSessionSchema = z
  .object({
    type: z.literal('timer/startSession'),
    id: IdSchema,
    now: z.number(),
    seconds: z.number().int().min(60).max(14400)
  })
  .strict();

const TimerPauseSchema = z
  .object({
    type: z.literal('timer/pause'),
    id: IdSchema,
    now: z.number(),
    at: z.number().optional()
  })
  .strict();

const TimerStopSchema = z
  .object({
    type: z.literal('timer/stop'),
    id: IdSchema,
    now: z.number()
  })
  .strict();

const TimerAddTimeSchema = z
  .object({
    type: z.literal('timer/addTime'),
    id: IdSchema,
    now: z.number(),
    seconds: z.number()
  })
  .strict();

const ListAddSchema = z
  .object({
    type: z.literal('list/add'),
    id: IdSchema,
    now: z.number(),
    name: z.string().min(1)
  })
  .strict();

const ListRenameSchema = z
  .object({
    type: z.literal('list/rename'),
    id: IdSchema,
    now: z.number(),
    name: z.string().min(1)
  })
  .strict();

const ListDeleteSchema = z
  .object({
    type: z.literal('list/delete'),
    id: IdSchema,
    now: z.number(),
    moveTasksTo: IdSchema
  })
  .strict();

const DayRolloverSchema = z
  .object({
    type: z.literal('day/rollover'),
    now: z.number(),
    date: YmdSchema
  })
  .strict();

const DayCloseSchema = z
  .object({
    type: z.literal('day/close'),
    now: z.number(),
    date: YmdSchema,
    note: z.string().optional()
  })
  .strict();

const SettingsPatchActionSchema = z
  .object({
    type: z.literal('settings/patch'),
    now: z.number(),
    patch: SettingsPatchSchema
  })
  .strict();

const DataReplaceSchema = z
  .object({
    type: z.literal('data/replace'),
    now: z.number(),
    data: DataSchema
  })
  .strict();

export const ActionSchema = z.discriminatedUnion('type', [
  TaskAddSchema,
  TaskEditSchema,
  TaskCompleteSchema,
  TaskUncompleteSchema,
  TaskDeleteSchema,
  TaskMoveSchema,
  TaskMakeCurrentSchema,
  TaskSkipSchema,
  TaskSnoozeSchema,
  TaskSetTodaySchema,
  TimerStartSchema,
  TimerStartSessionSchema,
  TimerPauseSchema,
  TimerStopSchema,
  TimerAddTimeSchema,
  ListAddSchema,
  ListRenameSchema,
  ListDeleteSchema,
  DayRolloverSchema,
  DayCloseSchema,
  SettingsPatchActionSchema,
  DataReplaceSchema
]);

// Keeps ActionSchema's members (each individually .strict()) in lockstep with every
// member of the Action union in types.ts.
const _actionSchemaTypeMatches: AssertEqual<z.infer<typeof ActionSchema>, Action> = true;
void _actionSchemaTypeMatches;

// --- parsing --------------------------------------------------------------

export class DataInvalidError extends Error {
  issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super('Invalid data: ' + issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    this.name = 'DataInvalidError';
    this.issues = issues;
  }
}

export function parseData(input: unknown): Data {
  const result = DataSchema.safeParse(input);
  if (!result.success) {
    throw new DataInvalidError(result.error.issues);
  }
  return result.data;
}

// Identical to DataSchema (`.extend` keeps `.strict()`) except `tasks` has no MAX_TASKS
// bound: used wherever existing data is READ back (load, backups, restore, the file
// watcher, import parsing) so a file that fails only the task-count bound still loads.
const DataSchemaForLoad = DataSchema.extend({ tasks: z.array(TaskSchema) });

/** `parseData` without the MAX_TASKS bound — see `DataSchemaForLoad`. */
export function parseDataForLoad(input: unknown): Data {
  const result = DataSchemaForLoad.safeParse(input);
  if (!result.success) {
    throw new DataInvalidError(result.error.issues);
  }
  return result.data;
}
