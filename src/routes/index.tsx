import { createFileRoute } from "@tanstack/react-router";
import { Board } from "@/components/board";
import { useCatalog } from "@/lib/use-catalog";

type Search = { q: string; motor: string };

function asText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" || typeof parsed === "number" ? String(parsed) : trimmed;
    } catch {
      return trimmed.replaceAll('"', "");
    }
  }
  return trimmed;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    q: asText(search.q),
    motor: asText(search.motor),
  }),
  component: Home,
});

function Home() {
  const { q, motor } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { catalog, loading, error, reload } = useCatalog();

  return (
    <Board
      motors={catalog.motors}
      loading={loading}
      error={error}
      onReload={() => void reload()}
      query={q}
      motorId={motor}
      onQuery={(next) => {
        void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true });
      }}
      onMotor={(id) => {
        void navigate({ search: (prev) => ({ ...prev, motor: id }), replace: true });
      }}
    />
  );
}
