import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Sample } from "@/lib/motors";

export type Series = { name: string; color: string; samples: Sample[] };

function interp(samples: Sample[], time: number) {
  if (!samples.length) return null;
  if (time <= samples[0].time) return samples[0].thrust;
  const last = samples[samples.length - 1];
  if (time >= last.time) return last.thrust;
  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index];
    const prev = samples[index - 1];
    if (time <= next.time) {
      const span = next.time - prev.time || 1;
      return prev.thrust + ((next.thrust - prev.thrust) * (time - prev.time)) / span;
    }
  }
  return null;
}

export function toRows(series: Series[]) {
  const times = new Set<number>();
  series.forEach((item) => item.samples.forEach((sample) => times.add(Number(sample.time.toFixed(3)))));
  return [...times].sort((a, b) => a - b).map((time) => {
    const row: Record<string, number> = { time };
    series.forEach((item) => {
      const value = interp(item.samples, time);
      if (value != null) row[item.name] = Math.round(value * 10) / 10;
    });
    return row;
  });
}

const axis = { fill: "var(--color-muted)", fontSize: 11, fontFamily: "var(--font-mono)" };

export function ThrustCurve({ series, height = 220 }: { series: Series[]; height?: number }) {
  if (!series.length) return null;
  const rows = toRows(series);
  return (
    <div className="h-full w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey="time" tick={axis} tickFormatter={(value: number) => `${value}s`} />
          <YAxis tick={axis} width={46} tickFormatter={(value: number) => `${value}`} />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              color: "var(--color-fg)",
            }}
            labelFormatter={(label) => `${label} s`}
            formatter={(value, name) => [`${value} N`, name]}
          />
          {series.length > 1 ? <Legend /> : null}
          {series.map((item) => (
            <Line
              key={item.name}
              type="monotone"
              dataKey={item.name}
              stroke={item.color}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
