import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { time, type Workout } from "../../shared/domain";
export function IntegrationPanel() {
  const q = useQueryClient(),
    status = useQuery<any>({
      queryKey: ["integration"],
      queryFn: () => api("/integrations/athledata/diagnostics"),
    });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  async function act(path: string, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const r = await api("/integrations/athledata" + path, method, {});
      if (r.authorizationUrl) location.assign(r.authorizationUrl);
      else
        setResult(
          r.remoteRevocation === "revoke_in_provider_account"
            ? "Frakoblet lokalt. Trekk også tilbake tilgangen i AthleData."
            : r.imported !== undefined
              ? `${r.imported} aktiviteter behandlet.${r.nextCursor ? " Flere sider gjenstår; synkroniser igjen." : ""}`
              : "Handlingen er fullført.",
        );
      await q.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>AthleData</h2>
      <p>
        {status.data?.status === "connected"
          ? "Tilkoblet"
          : "Ikke tilkoblet / krever oppsett"}
      </p>
      {status.data?.missingSettings?.length > 0 && (
        <p className="muted">
          Mangler serveroppsett: {status.data.missingSettings.join(", ")}.
          Nøkler legges aldri inn her.
        </p>
      )}
      <div className="row wrap">
        <Button
          disabled={busy || !navigator.onLine}
          onClick={() => act("/connect")}
        >
          Koble til AthleData
        </Button>
        <Button
          variant="secondary"
          disabled={busy || status.data?.status !== "connected"}
          onClick={() => act("/discover")}
        >
          Hent verktøy
        </Button>
        <Button
          variant="secondary"
          disabled={
            busy ||
            status.data?.status !== "connected" ||
            !status.data?.contractConfigured
          }
          onClick={() => act("/sync")}
        >
          Synkroniser aktiviteter
        </Button>
        <Button
          variant="danger"
          disabled={busy || status.data?.status === "disconnected"}
          onClick={() => {
            if (
              confirm("Koble fra AthleData? Importerte aktiviteter beholdes.")
            )
              void act("", "DELETE");
          }}
        >
          Koble fra
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && <p role="status">{result}</p>}
      <details>
        <summary>Tilkoblingsdiagnostikk</summary>
        <p>
          Siste vellykkede import:{" "}
          {status.data?.lastSuccessAt
            ? new Date(status.data.lastSuccessAt).toLocaleString("nb-NO")
            : "Ingen"}
        </p>
        <p>Siste feil: {status.data?.lastErrorCode || "Ingen registrert"}</p>
        <p>
          Providerkontrakt:{" "}
          {status.data?.contractConfigured
            ? "Konfigurert; skjema kontrolleres før hver operasjon"
            : "Ikke gjennomgått"}
        </p>
        <p>
          Oppdagede verktøy:{" "}
          {status.data?.toolSchemas?.map((t: any) => t.name).join(", ") ||
            "Ingen"}
        </p>
      </details>
      <p className="muted">
        En godkjent providerkontrakt kreves før import og Garmin-sending. Sendt
        til Garmin betyr ikke bekreftet mottatt på klokken.
      </p>
    </section>
  );
}
export function GarminActions({ workout }: { workout: Workout }) {
  const q = useQueryClient(),
    status = useQuery<any>({
      queryKey: ["integration"],
      queryFn: () => api("/integrations/athledata/diagnostics"),
    }),
    operations = useQuery<any[]>({
      queryKey: ["sync"],
      queryFn: () => api("/sync/operations"),
    });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const latest = operations.data?.find((o) => o.workout_id === workout.id);
  async function send(action: "send" | "delete") {
    setBusy(true);
    setError("");
    try {
      await api(
        `/workouts/${workout.id}/garmin`,
        "POST",
        { action },
        workout.version,
      );
      await q.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Garmin</h3>
      <p>
        Status: {latest?.state || "Ikke sendt"}
        {latest?.last_error_code ? ` · ${latest.last_error_code}` : ""}
      </p>
      <div className="row wrap">
        <Button
          disabled={
            busy ||
            !navigator.onLine ||
            status.data?.status !== "connected" ||
            !status.data?.contractConfigured
          }
          onClick={() => send("send")}
        >
          Send lagret revisjon til Garmin
        </Button>
        <Button
          variant="danger"
          disabled={
            busy ||
            status.data?.status !== "connected" ||
            !status.data?.contractConfigured
          }
          onClick={() => {
            if (
              confirm("Fjerne økten som ENDURANCE OS har opprettet i Garmin?")
            )
              void send("delete");
          }}
        >
          Fjern fra Garmin
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function ImportedActivities() {
  const q = useQueryClient(),
    list = useQuery<any[]>({
      queryKey: ["activities"],
      queryFn: () => api("/activities"),
    });
  const [detail, setDetail] = useState<any>(null),
    [matches, setMatches] = useState<any[]>([]),
    [error, setError] = useState("");
  async function open(id: string) {
    try {
      setDetail(await api("/activities/" + id));
      setMatches(await api("/activities/" + id + "/matches"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function link(m: any) {
    try {
      await api(
        "/activities/" + detail.activity.id + "/link",
        "POST",
        {
          workoutId: m.workoutId,
          workoutVersion: m.version,
          plannedRevision: m.revision,
        },
        detail.activity.version,
      );
      await q.invalidateQueries();
      await open(detail.activity.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <h2>Importerte Garmin-aktiviteter</h2>
      {!list.data?.length && (
        <p className="muted">
          Ingen aktiviteter er importert. Manuelt registrerte økter beholdes
          separat.
        </p>
      )}
      {list.data?.map((a) => (
        <Button key={a.id} variant="secondary" onClick={() => open(a.id)}>
          {a.local_date} · {a.sport} · {time(a.elapsed_s)}
        </Button>
      ))}
      {detail && (
        <div>
          <h3>Planlagt mot gjennomført</h3>
          <p>
            Planlagt: {time(detail.comparison.plannedSeconds)} · Faktisk:{" "}
            {time(detail.comparison.actualSeconds)}
          </p>
          <p>
            Avvik:{" "}
            {detail.comparison.deltaSeconds === null
              ? "Ikke beregnbart"
              : `${Math.round(detail.comparison.deltaSeconds / 60)} min`}
          </p>
          {!detail.planned &&
            matches.map((m) => (
              <div key={m.workoutId}>
                <p>
                  {m.title} · samsvar {Math.round(m.score * 100)} % · krever
                  manuell vurdering
                </p>
                <Button onClick={() => link(m)}>Koble til denne økten</Button>
              </div>
            ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
