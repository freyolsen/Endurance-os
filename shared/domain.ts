import { z } from "zod";
export const sports = {
  running: "Løping",
  cycling: "Sykling",
  xc_skiing: "Langrenn",
  skierg: "SkiErg",
  swimming: "Svømming",
  strength: "Styrke",
  recovery: "Restitusjon",
  mobility: "Mobilitet",
} as const;
export const sportSchema = z.enum(
  Object.keys(sports) as [keyof typeof sports, ...(keyof typeof sports)[]],
);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
  );
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function shift(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monday(date: string) {
  return shift(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
}
export type Step = {
  kind: "warmup" | "work" | "recovery" | "cooldown" | "repeat";
  durationKind: "time_s" | "distance_m";
  value: number;
  count: number;
  target: "none" | "hr_bpm" | "pace_sec_km" | "power_w" | "ftp_pct" | "rpe";
  min: number;
  max: number;
  children: Step[];
};
export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z
    .object({
      kind: z.enum(["warmup", "work", "recovery", "cooldown", "repeat"]),
      durationKind: z.enum(["time_s", "distance_m"]),
      value: z.number().positive().max(86400),
      count: z.number().int().min(2).max(100),
      target: z.enum([
        "none",
        "hr_bpm",
        "pace_sec_km",
        "power_w",
        "ftp_pct",
        "rpe",
      ]),
      min: z.number().min(0).max(10000),
      max: z.number().min(0).max(10000),
      children: z.array(stepSchema).max(100),
    })
    .strict()
    .refine(
      (s) =>
        s.max >= s.min &&
        (s.target !== "rpe" || s.max <= 10) &&
        (s.kind === "repeat" ? s.children.length > 0 : s.children.length === 0),
    ),
);
export function duration(steps: Step[]): {
  seconds: number | null;
  estimated: boolean;
} {
  let seconds = 0,
    estimated = false;
  for (const s of steps) {
    if (s.kind === "repeat") {
      const d = duration(s.children);
      if (d.seconds === null) return { seconds: null, estimated: false };
      seconds += s.count * d.seconds;
      estimated ||= d.estimated;
    } else if (s.durationKind === "time_s") seconds += s.value;
    else if (s.target === "pace_sec_km" && s.min > 0) {
      seconds += ((s.value / 1000) * (s.min + s.max)) / 2;
      estimated = true;
    } else return { seconds: null, estimated: false };
  }
  return { seconds, estimated };
}
export function complexity(steps: Step[], depth = 1): number {
  if (depth > 4) throw Error("For mange nivåer");
  return steps.reduce(
    (n, s) =>
      n +
      (s.kind === "repeat" ? s.count * complexity(s.children, depth + 1) : 1),
    0,
  );
}
export const definitionSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    sport: sportSchema,
    description: z.string().max(4000).default(""),
    intensity: z.enum(["easy", "moderate", "hard", "unspecified"]),
    steps: z.array(stepSchema).max(100),
  })
  .strict()
  .refine(
    (d) => {
      try {
        return complexity(d.steps) <= 500;
      } catch {
        return false;
      }
    },
    { message: "Maksimalt 4 nivåer og 500 utvidede steg" },
  );
export const workoutSchema = definitionSchema.and(
  z.object({ calendarDate: dateSchema }),
);
export const inputSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    sport: sportSchema,
    description: z.string().max(4000).default(""),
    intensity: z.enum(["easy", "moderate", "hard", "unspecified"]),
    steps: z.array(stepSchema).max(100),
    calendarDate: dateSchema,
  })
  .strict()
  .refine((d) => {
    try {
      return complexity(d.steps) <= 500;
    } catch {
      return false;
    }
  });
export type Definition = z.infer<typeof definitionSchema>;
export type Workout = Definition & {
  id: string;
  calendarDate: string;
  version: number;
  revision: number;
  locked: boolean;
  completedSeconds: number | null;
  completedAt: string | null;
  completionSource?: "imported" | "manual" | null;
  manualCompletedSeconds?: number | null;
  garminRevision?: number | null;
};
export const profileSchema = z
  .object({
    maxHr: z.number().int().min(80).max(240),
    ftp: z.number().int().min(1).max(1000),
    pb10k: z.number().int().min(1000).max(20000),
  })
  .strict();
export const goalSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    sport: sportSchema,
    eventDate: dateSchema.nullable(),
    target: z.string().max(200),
  })
  .strict();
export const newStep = (kind: Step["kind"] = "work"): Step => ({
  kind,
  durationKind: "time_s",
  value: 600,
  count: 5,
  target: "none",
  min: 0,
  max: 0,
  children: kind === "repeat" ? [newStep("work"), newStep("recovery")] : [],
});
export const time = (seconds: number | null) =>
  seconds === null ? "Ukjent varighet" : `${Math.round(seconds / 60)} min`;
