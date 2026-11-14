"use client";

const SIZE = 44;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  title: string;
  active: boolean;
  playing: boolean;
  loading: boolean;
  progress: number;
  onToggle: () => void;
};

// A round play/pause button; the green ring fills as the sample plays.
export function SampleButton({ title, active, playing, loading, progress, onToggle }: Props) {
  const label = playing ? `Pause sample of ${title}` : `Play sample of ${title}`;
  return (
    <button
      type="button"
      className={`sample-btn${active ? " active" : ""}${loading ? " loading" : ""}`}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={playing}
      title={playing ? "Pause sample" : "Play sample"}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="sample-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        <circle
          className="sample-ring"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={loading ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * (1 - (active ? progress : 0))}
        />
        <circle className="sample-face" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS - 5} />
        {playing ? (
          <g className="sample-icon">
            <rect x={17} y={15} width={3.5} height={14} rx={1} />
            <rect x={23.5} y={15} width={3.5} height={14} rx={1} />
          </g>
        ) : (
          <path className="sample-icon" d="M18.5 14.5 L29.5 22 L18.5 29.5 Z" />
        )}
      </svg>
    </button>
  );
}
