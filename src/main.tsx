import React, { useState, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  Dumbbell,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
  Copy,
  Trash2,
  Check,
  LogOut,
  WifiOff,
  ArrowUpRight,
} from "lucide-react";
const WeeklyChart = lazy(() => import("./components/weekly-chart"));
import { Button } from "./components/ui/button";
import { api, setCsrf } from "./lib/api";
import {
  sports,
  today,
  shift,
  monday,
  duration,
  newStep,
  time,
  inputSchema,
  definitionSchema,
  type Step,
  type Workout,
  type Definition,
} from "../shared/domain";
import "./style.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const nav = [
  ["home", "Hjem", Activity],
  ["calendar", "Kalender", CalendarDays],
  ["analysis", "Analyse", ChartNoAxesCombined],
  ["workouts", "Økter", Dumbbell],
  ["settings", "Innstillinger", Settings],
] as const;
const intensity = {
  easy: "Rolig",
  moderate: "Moderat",
  hard: "Hard",
  unspecified: "Ikke angitt",
};
const kinds = {
  warmup: "Oppvarming",
  work: "Arbeid",
  recovery: "Pause",
  cooldown: "Nedtrapping",
  repeat: "Gjenta",
};
const targetNames = {
  none: "Ingen mål",
  hr_bpm: "Puls · bpm",
  pace_sec_km: "Tempo · sek/km",
  power_w: "Effekt · W",
  ftp_pct: "FTP · %",
  rpe: "RPE · 0–10",
};
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Lukk">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Steps({
  steps,
  onChange,
  depth = 0,
}: {
  steps: Step[];
  onChange: (s: Step[]) => void;
  depth?: number;
}) {
  const update = (i: number, patch: Partial<Step>) =>
    onChange(steps.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div className="step" key={i}>
          <div className="row">
            <strong>
              {i + 1}. {kinds[s.kind]}
            </strong>
            <div className="spacer" />
            <Button
              type="button"
              variant="ghost"
              disabled={i === 0}
              aria-label="Flytt steg opp"
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={i === steps.length - 1}
              aria-label="Flytt steg ned"
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label="Fjern steg"
              onClick={() => onChange(steps.filter((_, n) => n !== i))}
            >
              <X size={16} />
            </Button>
          </div>
          {s.kind === "repeat" ? (
            <>
              <label>
                Antall repetisjoner
                <input
                  type="number"
                  min="2"
                  max="100"
                  value={s.count}
                  onChange={(e) => update(i, { count: Number(e.target.value) })}
                />
              </label>
              <Steps
                depth={depth + 1}
                steps={s.children}
                onChange={(children) => update(i, { children })}
              />
            </>
          ) : (
            <div className="fields">
              <label>
                Lengde
                <select
                  value={s.durationKind}
                  onChange={(e) =>
                    update(i, {
                      durationKind: e.target.value as Step["durationKind"],
                    })
                  }
                >
                  <option value="time_s">Sekunder</option>
                  <option value="distance_m">Meter</option>
                </select>
              </label>
              <label>
                Verdi
                <input
                  type="number"
                  min="1"
                  value={s.value}
                  onChange={(e) => update(i, { value: Number(e.target.value) })}
                />
              </label>
              <label>
                Mål
                <select
                  value={s.target}
                  onChange={(e) =>
                    update(i, { target: e.target.value as Step["target"] })
                  }
                >
                  {Object.entries(targetNames).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {s.target !== "none" && (
                <>
                  <label>
                    Fra
                    <input
                      type="number"
                      value={s.min}
                      onChange={(e) =>
                        update(i, { min: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Til
                    <input
                      type="number"
                      value={s.max}
                      onChange={(e) =>
                        update(i, { max: Number(e.target.value) })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="row wrap">
        {Object.entries(kinds)
          .filter(([key]) => key !== "repeat" || depth < 3)
          .map(([kind, label]) => (
            <Button
              key={kind}
              type="button"
              variant="secondary"
              onClick={() =>
                onChange([...steps, newStep(kind as Step["kind"])])
              }
            >
              <Plus size={14} />
              {label}
            </Button>
          ))}
      </div>
    </div>
  );
}
function Editor({
  initial,
  date,
  template,
  onSave,
  onClose,
}: {
  initial?: Definition;
  date: string;
  template?: boolean;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      title: initial?.title || "",
      sport: initial?.sport || "running",
      description: initial?.description || "",
      intensity: initial?.intensity || "easy",
      calendarDate: date,
    },
  });
  const [steps, setSteps] = useState(
    initial?.steps || [newStep("warmup"), newStep("work"), newStep("cooldown")],
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const d = duration(steps);
  return (
    <Modal
      title={template ? "Øktmal" : initial ? "Rediger økt" : "Planlegg en økt"}
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit(async (data) => {
          setBusy(true);
          setError("");
          try {
            const value = { ...data, steps };
            if (template) {
              const { calendarDate: _, ...definition } = value;
              void _;
              await onSave(definitionSchema.parse(definition));
            } else await onSave(inputSchema.parse(value));
            onClose();
          } catch (err) {
            setError(
              err instanceof Error && err.message.startsWith("[")
                ? "Kontroller alle felter og målverdier."
                : String(err instanceof Error ? err.message : err),
            );
          } finally {
            setBusy(false);
          }
        })}
      >
        <label>
          Navn på økten
          <input
            autoFocus
            {...register("title", { required: true })}
            placeholder="For eksempel rolig langtur"
          />
        </label>
        <div className="fields">
          <label>
            Idrett
            <select {...register("sport")}>
              {Object.entries(sports).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {!template && (
            <label>
              Dato
              <input
                type="date"
                {...register("calendarDate", { required: true })}
              />
            </label>
          )}
          <label>
            Intensitet
            <select {...register("intensity")}>
              {Object.entries(intensity).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Beskrivelse
          <textarea
            {...register("description")}
            placeholder="Hva vil du fokusere på?"
          />
        </label>
        <div className="section-title">
          <h3>Bygg økten</h3>
          <span>
            {d.estimated ? "Estimert: " : ""}
            {time(d.seconds)}
          </span>
        </div>
        <Steps steps={steps} onChange={setSteps} />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Avbryt
          </Button>
          <Button disabled={busy}>{busy ? "Lagrer…" : "Lagre"}</Button>
        </div>
      </form>
    </Modal>
  );
}
function Card({ w, onClick }: { w: Workout; onClick: () => void }) {
  const d = duration(w.steps);
  return (
    <button
      draggable={!w.locked}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", w.id)}
      className={`workout sport-${w.sport}`}
      onClick={onClick}
    >
      <span className="eyebrow">
        {sports[w.sport]} {w.locked && <Lock size={12} />}
      </span>
      <strong>{w.title}</strong>
      <span>
        {time(d.seconds)} {d.estimated ? "· estimert" : ""} ·{" "}
        {intensity[w.intensity]}
      </span>
      <span className={w.completedAt ? "completed" : "muted"}>
        {w.completedAt ? "✓ Gjennomført manuelt" : "Planlagt"} · Ikke
        synkronisert
      </span>
    </button>
  );
}
async function cacheCalendar(data: Workout[] | null) {
  const request = indexedDB.open("endurance-offline", 1);
  return new Promise<void>((resolve, reject) => {
    request.onupgradeneeded = () =>
      request.result.createObjectStore("calendar");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction("calendar", "readwrite");
      if (data)
        tx.objectStore("calendar").put(
          {
            at: Date.now(),
            data: data.map((w) => ({ ...w, description: "" })),
          },
          "snapshot",
        );
      else tx.objectStore("calendar").clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}
async function readCache(): Promise<Workout[]> {
  return new Promise((resolve) => {
    const r = indexedDB.open("endurance-offline", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("calendar");
    r.onerror = () => resolve([]);
    r.onsuccess = () => {
      const q = r.result
        .transaction("calendar")
        .objectStore("calendar")
        .get("snapshot");
      q.onsuccess = () => {
        resolve(
          q.result && Date.now() - q.result.at < 604800000 ? q.result.data : [],
        );
        r.result.close();
      };
      q.onerror = () => resolve([]);
    };
  });
}
function App() {
  const qc = useQueryClient();
  const [logged, setLogged] = useState(false),
    [checking, setChecking] = useState(true),
    [offline, setOffline] = useState(!navigator.onLine),
    [cached, setCached] = useState<Workout[]>([]),
    [local, setLocal] = useState(false),
    [page, setPage] = useState("home"),
    [date, setDate] = useState(today()),
    [view, setView] = useState("week"),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<any>(null),
    [selected, setSelected] = useState<Workout | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("");
  useEffect(() => {
    api("/auth/session")
      .then((s) => {
        setCsrf(s.csrf);
        setLocal(s.local);
        setLogged(true);
      })
      .catch(() => {
        if (navigator.onLine) void cacheCalendar(null);
      })
      .finally(() => setChecking(false));
    readCache().then(setCached);
    const on = () => setOffline(!navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  const workouts = useQuery<Workout[]>({
    queryKey: ["workouts"],
    queryFn: () => api("/workouts"),
    enabled: logged && !offline,
  });
  const templates = useQuery<any[]>({
    queryKey: ["templates"],
    queryFn: () => api("/templates"),
    enabled: logged && !offline,
  });
  const profile = useQuery<any>({
    queryKey: ["profile"],
    queryFn: () => api("/profile"),
    enabled: logged && !offline,
  });
  const goals = useQuery<any[]>({
    queryKey: ["goals"],
    queryFn: () => api("/goals"),
    enabled: logged && !offline,
  });
  const preferences = useQuery<any>({
    queryKey: ["preferences"],
    queryFn: () => api("/preferences"),
    enabled: logged && !offline,
  });
  useEffect(() => {
    if (preferences.data?.offlineEnabled && workouts.data)
      void cacheCalendar(
        workouts.data.filter(
          (w) =>
            w.calendarDate >= shift(today(), -28) &&
            w.calendarDate <= shift(today(), 56),
        ),
      )
        .then(() => readCache())
        .then(setCached)
        .catch(() => setError("Kunne ikke lagre kalenderen på enheten."));
  }, [workouts.data, preferences.data]);
  const all = offline ? cached : workouts.data || [];
  const run = async (fn: () => Promise<any>) => {
    setError("");
    try {
      if (offline) throw new Error("Endringer krever nettilkobling.");
      await fn();
      await qc.invalidateQueries();
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const login = async () => {
    try {
      const s = await api("/auth/session", "POST", {});
      setCsrf(s.csrf);
      setLocal(s.local);
      setLogged(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (checking)
    return (
      <div className="login">
        <Activity />
        <p>Åpner treningsrommet…</p>
      </div>
    );
  if (!logged && !(offline && cached.length))
    return (
      <div className="login">
        <div className="brand">
          <Activity /> ENDURANCE<span>OS</span>
        </div>
        <h1>
          Ditt neste steg
          <br />
          starter her.
        </h1>
        <p>Et privat rom for trening, kontinuitet og fremgang.</p>
        <Button onClick={login}>
          Logg inn <ArrowUpRight size={18} />
        </Button>
        <small>Kun for eieren · Sikker økt</small>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    );
  const week = all.filter(
    (w) =>
      w.calendarDate >= monday(today()) &&
      w.calendarDate <= shift(monday(today()), 6),
  );
  const planned = week.reduce(
      (n, w) => n + (duration(w.steps).seconds || 0),
      0,
    ),
    completed = week.reduce((n, w) => n + (w.completedSeconds || 0), 0);
  const dates =
    view === "day"
      ? [date]
      : view === "week"
        ? Array.from({ length: 7 }, (_, i) => shift(monday(date), i))
        : Array.from({ length: 42 }, (_, i) =>
            shift(monday(date.slice(0, 8) + "01"), i),
          );
  const newWorkout = (day = date) => setEditor({ date: day });
  const open = (w: Workout) => setSelected(w);
  const metric = (label: string, value: string, sub: string) => (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <Activity /> ENDURANCE<span>OS</span>
        </div>
        <span className="nav-caption">DITT TRENINGSROM</span>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" /> Personlig treningsplan
          <small>{local ? "Lokal utviklingskonto" : "Privat eierkonto"}</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">
              ENDURANCE OS / {nav.find((n) => n[0] === page)?.[1]}
            </span>
            <h1>
              {page === "home"
                ? "Bygg formen. Dag for dag."
                : nav.find((n) => n[0] === page)?.[1]}
            </h1>
          </div>
          <Button disabled={offline} onClick={() => newWorkout()}>
            <Plus size={18} />
            <span>Ny økt</span>
          </Button>
        </header>
        {offline && (
          <div className="notice">
            <WifiOff size={18} /> Frakoblet · Kalenderen er skrivebeskyttet.
            Sist lagrede enhetskopi.
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
            <Button
              variant="ghost"
              onClick={() => setError("")}
              aria-label="Lukk feilmelding"
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {workouts.error && (
          <div className="error">
            {workouts.error.message}
            <Button variant="secondary" onClick={() => workouts.refetch()}>
              Prøv igjen
            </Button>
          </div>
        )}
        {page === "home" && (
          <>
            <div className="intro">
              <span className="eyebrow">
                {new Intl.DateTimeFormat("nb-NO", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "Europe/Oslo",
                }).format(new Date())}
              </span>
              <p>Gi hver økt en hensikt. Gjør plass til fremgang.</p>
            </div>
            <div className="metrics">
              {metric(
                "Planlagt denne uken",
                (planned / 3600).toFixed(1).replace(".", ",") + " t",
                "Planlagt · kjente varigheter",
              )}
              {metric(
                "Gjennomført",
                (completed / 3600).toFixed(1).replace(".", ",") + " t",
                "Observert · manuelt registrert",
              )}
              {metric(
                "Økter denne uken",
                String(week.length),
                "Planlagt i kalenderen",
              )}
            </div>
            <div className="dashboard-grid">
              <section className="panel">
                <div className="section-title">
                  <h2>I dag</h2>
                  <span className="tag">{today()}</span>
                </div>
                {all
                  .filter((w) => w.calendarDate === today())
                  .map((w) => (
                    <Card key={w.id} w={w} onClick={() => open(w)} />
                  ))}
                {!all.some((w) => w.calendarDate === today()) && (
                  <div className="empty">
                    <CalendarDays />
                    <h3>Plass til en god økt.</h3>
                    <p>
                      Planlegg dagen, eller gi kroppen tid til å hente seg inn.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={offline}
                      onClick={() => newWorkout(today())}
                    >
                      Planlegg en økt
                    </Button>
                  </div>
                )}
              </section>
              <section className="panel">
                <h2>På horisonten</h2>
                {all
                  .filter((w) => w.calendarDate > today())
                  .slice(0, 4)
                  .map((w) => (
                    <div key={w.id} className="upcoming">
                      <span>
                        {w.calendarDate.slice(8)}
                        <small>{w.calendarDate.slice(5, 7)}</small>
                      </span>
                      <Card w={w} onClick={() => open(w)} />
                    </div>
                  ))}
                {!all.some((w) => w.calendarDate > today()) && (
                  <p className="muted">
                    Neste kapittel er ditt. Legg til en kommende økt.
                  </p>
                )}
              </section>
            </div>
            <div className="dashboard-grid">
              <section className="panel">
                <h2>Ukens fordeling</h2>
                {Object.entries(sports).map(([key, name]) => {
                  const seconds = week
                    .filter((w) => w.sport === key)
                    .reduce((n, w) => n + (duration(w.steps).seconds || 0), 0);
                  return seconds > 0 ? (
                    <div key={key} className="distribution">
                      <span>{name}</span>
                      <div>
                        <i
                          style={{
                            width: `${planned ? (seconds / planned) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span>{time(seconds)}</span>
                    </div>
                  ) : null;
                })}
                {!planned && (
                  <p className="muted">
                    Planlagt volum vises når du har lagt til økter.
                  </p>
                )}
              </section>
              <section className="panel">
                <h2>Restitusjon & form</h2>
                <div className="placeholder-metrics">
                  {[
                    "HRV",
                    "Hvilepuls",
                    "Søvn",
                    "Treningsbelastning",
                    "CTL / ATL / TSB",
                  ].map((x) => (
                    <span key={x}>
                      {x}
                      <strong>—</strong>
                    </span>
                  ))}
                </div>
                <p className="muted">
                  Koble til AthleData for å se treningsdata. Integrasjonen
                  kommer i neste fase.
                </p>
              </section>
            </div>
            <section className="panel">
              <h2>Dine mål</h2>
              {goals.data?.map((g) => (
                <p key={g.id}>
                  <strong>{g.name}</strong>{" "}
                  <span className="muted">
                    {g.target} · {g.eventDate || "Dato ikke satt"}
                  </span>
                </p>
              ))}
              {!goals.data?.length && (
                <p className="muted">
                  Legg til målene dine under Innstillinger.
                </p>
              )}
            </section>
          </>
        )}
        {page === "calendar" && (
          <>
            <div className="toolbar">
              <div className="row">
                <Button
                  variant="secondary"
                  aria-label="Forrige periode"
                  onClick={() =>
                    setDate(
                      view === "month"
                        ? shift(date.slice(0, 8) + "01", -1)
                        : shift(date, view === "day" ? -1 : -7),
                    )
                  }
                >
                  <ChevronLeft size={18} />
                </Button>
                <input
                  aria-label="Valgt dato"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <Button
                  variant="secondary"
                  aria-label="Neste periode"
                  onClick={() =>
                    setDate(
                      view === "month"
                        ? shift(date.slice(0, 8) + "01", 32).slice(0, 8) + "01"
                        : shift(date, view === "day" ? 1 : 7),
                    )
                  }
                >
                  <ChevronRight size={18} />
                </Button>
                <Button variant="ghost" onClick={() => setDate(today())}>
                  I dag
                </Button>
              </div>
              <div className="segmented">
                {[
                  ["day", "Dag"],
                  ["week", "Uke"],
                  ["month", "Måned"],
                ].map(([key, name]) => (
                  <button
                    key={key}
                    className={view === key ? "chosen" : ""}
                    onClick={() => setView(key)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className={`calendar ${view}`}>
              {dates.map((day) => (
                <section
                  key={day}
                  className={`day ${day === today() ? "today" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (offline) return;
                    const w = all.find(
                      (x) => x.id === e.dataTransfer.getData("text/plain"),
                    );
                    if (w && !w.locked)
                      void run(() =>
                        api(
                          `/workouts/${w.id}/move`,
                          "POST",
                          { calendarDate: day },
                          w.version,
                        ),
                      );
                  }}
                >
                  <div className="day-heading">
                    <span>
                      {new Intl.DateTimeFormat("nb-NO", {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(new Date(day))}
                      <strong>{day.slice(8)}</strong>
                    </span>
                    <Button
                      variant="ghost"
                      disabled={offline}
                      aria-label={`Ny økt ${day}`}
                      onClick={() => newWorkout(day)}
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                  {all
                    .filter((w) => w.calendarDate === day)
                    .map((w) => (
                      <Card key={w.id} w={w} onClick={() => open(w)} />
                    ))}
                </section>
              ))}
            </div>
            <p className="muted">
              Dra en ulåst økt til en annen dag, eller åpne økten for å flytte
              den.
            </p>
          </>
        )}
        {page === "workouts" && (
          <>
            <div className="toolbar">
              <input
                placeholder="Søk i øktmaler"
                aria-label="Søk i øktmaler"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filtrer idrett"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">Alle idretter</option>
                {Object.entries(sports).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Button
                disabled={offline}
                onClick={() => setEditor({ template: true, date })}
              >
                Ny mal
              </Button>
            </div>
            <div className="template-grid">
              {templates.data
                ?.filter(
                  (t) =>
                    t.title.toLowerCase().includes(search.toLowerCase()) &&
                    (!filter || t.sport === filter),
                )
                .map((t) => (
                  <section className="panel" key={t.id}>
                    <span className="eyebrow">
                      {sports[t.sport as keyof typeof sports]}
                    </span>
                    <h2>{t.title}</h2>
                    <p>{time(duration(t.steps).seconds)}</p>
                    <div className="row wrap">
                      <Button
                        disabled={offline}
                        onClick={() => setEditor({ initial: t, date })}
                      >
                        Legg i kalender
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={offline}
                        onClick={() =>
                          setEditor({
                            initial: t,
                            template: true,
                            id: t.id,
                            version: t.version,
                            date,
                          })
                        }
                      >
                        Rediger
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="Dupliser mal"
                        onClick={() =>
                          run(() =>
                            api("/templates", "POST", {
                              title: t.title + " – kopi",
                              sport: t.sport,
                              description: t.description,
                              intensity: t.intensity,
                              steps: t.steps,
                            }),
                          )
                        }
                      >
                        <Copy size={17} />
                      </Button>
                      <Button
                        variant="danger"
                        aria-label="Slett mal"
                        onClick={() => {
                          if (confirm("Slette denne malen?"))
                            void run(() =>
                              api(
                                "/templates/" + t.id,
                                "DELETE",
                                {},
                                t.version,
                              ),
                            );
                        }}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </div>
                  </section>
                ))}
            </div>
            {!templates.data?.length && (
              <div className="empty panel">
                <Dumbbell />
                <h2>Gode økter er verdt å gjenta.</h2>
                <p>Lag din første mal, eller lagre en økt fra kalenderen.</p>
              </div>
            )}
          </>
        )}
        {page === "analysis" && (
          <>
            <div className="metrics">
              {metric(
                "Planlagt denne uken",
                time(planned),
                "Kjente planlagte varigheter",
              )}
              {metric(
                "Manuelt gjennomført",
                time(completed),
                "Registrert faktisk varighet",
              )}
              {metric(
                "Kontinuitet",
                `${week.filter((w) => w.calendarDate <= today() && w.completedAt).length} / ${week.filter((w) => w.calendarDate <= today()).length}`,
                "Gjennomførte / planlagte hittil i uken",
              )}
            </div>
            <section className="panel">
              <h2>Treningsuken</h2>
              <p className="muted">
                Minutter · planlagt og manuelt gjennomført
              </p>
              <Suspense fallback={<p>Laster diagram…</p>}>
                <WeeklyChart workouts={all} />
              </Suspense>
            </section>
            <section className="panel">
              <h2>Månedsoversikt</h2>
              {Array.from(new Set(all.map((w) => w.calendarDate.slice(0, 7))))
                .sort()
                .map((m) => (
                  <p key={m}>
                    {m}{" "}
                    <strong>
                      {time(
                        all
                          .filter((w) => w.calendarDate.startsWith(m))
                          .reduce(
                            (n, w) => n + (duration(w.steps).seconds || 0),
                            0,
                          ),
                      )}
                    </strong>
                  </p>
                ))}
              {!all.length && (
                <p className="muted">Ingen planlagte økter ennå.</p>
              )}
            </section>
            <section className="panel">
              <h2>Gjennomførte økter</h2>
              {all
                .filter((w) => w.completedAt)
                .map((w) => (
                  <p key={w.id}>
                    {w.calendarDate} · {w.title} · {time(w.completedSeconds)}{" "}
                    <span className="tag">Manuelt registrert</span>
                  </p>
                ))}
            </section>
          </>
        )}
        {page === "settings" && (
          <>
            <section className="panel">
              <h2>Utøverprofil</h2>
              <p className="muted">
                Verdier du har oppgitt. Oppdater dem når formen endrer seg.
              </p>
              {profile.data && (
                <form
                  key={profile.data.version}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      api(
                        "/profile",
                        "PATCH",
                        {
                          maxHr: Number(f.get("maxHr")),
                          ftp: Number(f.get("ftp")),
                          pb10k: Number(f.get("pb10k")),
                        },
                        profile.data.version,
                      ),
                    );
                  }}
                >
                  <div className="fields">
                    <label>
                      Makspuls · bpm
                      <input
                        name="maxHr"
                        type="number"
                        defaultValue={profile.data.maxHr}
                      />
                    </label>
                    <label>
                      FTP · watt
                      <input
                        name="ftp"
                        type="number"
                        defaultValue={profile.data.ftp}
                      />
                    </label>
                    <label>
                      10 km pers · sekunder
                      <input
                        name="pb10k"
                        type="number"
                        defaultValue={profile.data.pb10k}
                      />
                    </label>
                  </div>
                  <Button disabled={offline}>Lagre profil</Button>
                </form>
              )}
            </section>
            <section className="panel">
              <h2>Treningsmål</h2>
              {goals.data?.map((g) => (
                <form
                  className="goal-row"
                  key={g.id + g.version}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      api(
                        "/goals/" + g.id,
                        "PATCH",
                        {
                          name: String(f.get("name")),
                          sport: g.sport,
                          target: String(f.get("target")),
                          eventDate: String(f.get("date")) || null,
                        },
                        g.version,
                      ),
                    );
                  }}
                >
                  <input
                    aria-label="Målnavn"
                    name="name"
                    defaultValue={g.name}
                  />
                  <input
                    aria-label="Målresultat"
                    name="target"
                    defaultValue={g.target}
                  />
                  <input
                    aria-label="Arrangementsdato"
                    name="date"
                    type="date"
                    defaultValue={g.eventDate || ""}
                  />
                  <Button variant="secondary">Lagre</Button>
                  <Button
                    type="button"
                    variant="danger"
                    aria-label="Slett mål"
                    onClick={() => {
                      if (confirm("Slette målet?"))
                        void run(() =>
                          api("/goals/" + g.id, "DELETE", {}, g.version),
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </form>
              ))}
              <form
                className="row wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    api("/goals", "POST", {
                      name: String(f.get("name")),
                      sport: "running",
                      target: "",
                      eventDate: null,
                    }),
                  );
                  e.currentTarget.reset();
                }}
              >
                <input
                  name="name"
                  placeholder="Nytt treningsmål"
                  aria-label="Nytt treningsmål"
                  required
                />
                <Button disabled={offline}>Legg til</Button>
              </form>
              {!goals.data?.length && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      for (const [name, sport, target] of [
                        ["Birkebeinerrennet", "xc_skiing", "3:30"],
                        ["Copenhagen Half Marathon", "running", ""],
                        ["10 km", "running", "Under 38 minutter"],
                        ["Backyard Ultra", "running", "24 runder / 160,8 km"],
                        ["Langsiktig triatlon", "swimming", ""],
                      ])
                        await api("/goals", "POST", {
                          name,
                          sport,
                          target,
                          eventDate: null,
                        });
                    })
                  }
                >
                  Legg til mine oppgitte mål
                </Button>
              )}
            </section>
            <section className="panel">
              <h2>Integrasjoner</h2>
              <div className="section-title">
                <strong>AthleData</strong>
                <span className="tag">Ikke tilkoblet</span>
              </div>
              <p className="muted">
                Garmin- og restitusjonsdata blir tilgjengelige i neste
                integrasjonsfase.
              </p>
            </section>
            <section className="panel">
              <h2>Kalender uten nett</h2>
              <p className="muted">
                Valgfri, skrivebeskyttet enhetskopi i opptil 7 dager. Kan leses
                av andre med tilgang til denne enheten. Ingen økter eller
                endringer lagres uten nett.
              </p>
              <Button
                variant="secondary"
                disabled={!preferences.data || offline}
                onClick={() =>
                  run(async () => {
                    const enabled = !preferences.data.offlineEnabled;
                    await api(
                      "/preferences",
                      "PATCH",
                      { offlineEnabled: enabled },
                      preferences.data.version,
                    );
                    if (!enabled) {
                      await cacheCalendar(null);
                      setCached([]);
                    }
                  })
                }
              >
                {preferences.data?.offlineEnabled
                  ? "Slå av og slett enhetskopi"
                  : "Tillat kalender på enheten"}
              </Button>
            </section>
            <Button
              variant="secondary"
              onClick={async () => {
                await cacheCalendar(null);
                setCached([]);
                try {
                  await api("/auth/session", "DELETE");
                } finally {
                  qc.clear();
                  setLogged(false);
                }
              }}
            >
              <LogOut size={17} /> Logg ut
            </Button>
          </>
        )}
      </main>
      {editor && (
        <Editor
          date={editor.date}
          initial={editor.initial}
          template={editor.template}
          onClose={() => setEditor(null)}
          onSave={async (data) => {
            await api(
              editor.template
                ? "/templates" + (editor.id ? "/" + editor.id : "")
                : "/workouts" + (editor.id ? "/" + editor.id : ""),
              editor.id ? "PUT" : "POST",
              data,
              editor.version,
            );
            await qc.invalidateQueries();
          }}
        />
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <span className="eyebrow">
            {sports[selected.sport]} · {selected.calendarDate}
          </span>
          <p>{selected.description || "Ingen beskrivelse lagt til."}</p>
          <div className="metrics small">
            {metric(
              "Planlagt",
              time(duration(selected.steps).seconds),
              intensity[selected.intensity],
            )}
            {metric(
              "Gjennomført",
              time(selected.completedSeconds),
              selected.completedAt
                ? "Manuelt registrert"
                : "Ingen registrering",
            )}
          </div>
          <ol>
            {selected.steps.map((s, i) => (
              <li key={i}>
                {kinds[s.kind]} ·{" "}
                {s.kind === "repeat"
                  ? `${s.count} repetisjoner`
                  : s.durationKind === "time_s"
                    ? time(s.value)
                    : `${s.value} m`}
              </li>
            ))}
          </ol>
          <div className="row wrap">
            <Button
              disabled={offline || selected.locked}
              onClick={() => {
                setEditor({
                  initial: selected,
                  id: selected.id,
                  version: selected.version,
                  date: selected.calendarDate,
                });
                setSelected(null);
              }}
            >
              Rediger
            </Button>
            <Button
              variant="secondary"
              disabled={offline}
              onClick={() =>
                run(() =>
                  api(
                    `/workouts/${selected.id}/lock`,
                    "PATCH",
                    { locked: !selected.locked },
                    selected.version,
                  ),
                )
              }
            >
              {selected.locked ? <Unlock size={16} /> : <Lock size={16} />}{" "}
              {selected.locked ? "Lås opp" : "Lås"}
            </Button>
            <Button
              variant="secondary"
              disabled={offline}
              onClick={() =>
                run(() =>
                  api(
                    `/workouts/${selected.id}/duplicate`,
                    "POST",
                    { calendarDate: selected.calendarDate },
                    selected.version,
                  ),
                )
              }
            >
              <Copy size={16} /> Dupliser
            </Button>
            <Button
              variant="secondary"
              disabled={offline}
              onClick={() =>
                run(() =>
                  api("/templates", "POST", {
                    title: selected.title,
                    sport: selected.sport,
                    description: selected.description,
                    intensity: selected.intensity,
                    steps: selected.steps,
                  }),
                )
              }
            >
              Lagre som mal
            </Button>
          </div>
          <form
            className="row wrap"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() =>
                api(
                  `/workouts/${selected.id}/move`,
                  "POST",
                  { calendarDate: String(f.get("date")) },
                  selected.version,
                ),
              );
            }}
          >
            <label>
              Flytt til dato
              <input
                name="date"
                type="date"
                defaultValue={selected.calendarDate}
                required
              />
            </label>
            <Button variant="secondary" disabled={offline || selected.locked}>
              Flytt økten
            </Button>
          </form>
          <form
            className="row wrap"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() =>
                api(
                  `/workouts/${selected.id}/complete`,
                  "POST",
                  { actualSeconds: Math.round(Number(f.get("minutes")) * 60) },
                  selected.version,
                ),
              );
            }}
          >
            <label>
              Faktisk gjennomført · minutter
              <input name="minutes" type="number" min="1" max="2880" required />
            </label>
            <Button disabled={offline}>
              <Check size={16} /> Marker gjennomført
            </Button>
          </form>
          {selected.completedAt && (
            <Button
              variant="ghost"
              disabled={offline}
              onClick={() =>
                run(() =>
                  api(
                    `/workouts/${selected.id}/complete`,
                    "POST",
                    { actualSeconds: null },
                    selected.version,
                  ),
                )
              }
            >
              Fjern registrering
            </Button>
          )}
          <Button
            variant="danger"
            disabled={offline || selected.locked}
            onClick={() => {
              if (confirm("Slette denne økten fra kalenderen?"))
                void run(() =>
                  api(
                    "/workouts/" + selected.id,
                    "DELETE",
                    {},
                    selected.version,
                  ),
                );
            }}
          >
            <Trash2 size={16} /> Slett økt
          </Button>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js");
