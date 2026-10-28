import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  shift,
  monday,
  today,
  duration,
  type Workout,
} from "../../shared/domain";
export default function WeeklyChart({ workouts }: { workouts: Workout[] }) {
  const data = Array.from({ length: 7 }, (_, i) => {
    const date = shift(monday(today()), i),
      ws = workouts.filter((w) => w.calendarDate === date);
    return {
      dag: date.slice(8),
      Planlagt: Math.round(
        ws.reduce((n, w) => n + (duration(w.steps).seconds || 0), 0) / 60,
      ),
      Gjennomført: Math.round(
        ws.reduce((n, w) => n + (w.completedSeconds || 0), 0) / 60,
      ),
    };
  });
  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <XAxis dataKey="dag" />
          <YAxis />
          <Tooltip
            contentStyle={{
              background: "#252b2f",
              border: "1px solid #343c41",
            }}
          />
          <Bar dataKey="Planlagt" fill="#CBF66A" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Gjennomført" fill="#66b8cf" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <details>
        <summary>Vis tallene som tabell</summary>
        <table>
          <thead>
            <tr>
              <th>Dag</th>
              <th>Planlagt · min</th>
              <th>Gjennomført · min</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.dag}>
                <td>{d.dag}</td>
                <td>{d.Planlagt}</td>
                <td>{d.Gjennomført}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
