// Waveform icon — 7 bars derived from sound-waveform-wave-svgrepo-com.svg
// On hover (or when animating=true), bars pulse left-to-right via staggered CSS animation.

interface Bar {
  x: number
  y: number
  h: number
  peak: number  // scaleY target at animation peak
}

const BARS: Bar[] = [
  { x: 4,  y: 13, h: 4,  peak: 3.2 },
  { x: 8,  y: 11, h: 8,  peak: 2.2 },
  { x: 12, y: 6,  h: 18, peak: 1.3 },
  { x: 16, y: 13, h: 4,  peak: 3.2 },
  { x: 20, y: 9,  h: 12, peak: 1.6 },
  { x: 24, y: 6,  h: 18, peak: 1.3 },
  { x: 28, y: 13, h: 4,  peak: 3.2 },
]

const BAR_WIDTH = 1.8
const BAR_DELAY = 0.085 // seconds between each bar

interface Props {
  size?: number
  className?: string
  /** External control — pass true to keep animating regardless of hover */
  animating?: boolean
}

export function WaveformIcon({ size = 18, className = '', animating = false }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {BARS.map((bar, i) => (
        <rect
          key={i}
          x={bar.x - BAR_WIDTH / 2}
          y={bar.y}
          width={BAR_WIDTH}
          height={bar.h}
          rx={BAR_WIDTH / 2}
          fill="currentColor"
          className={`wf-bar${animating ? ' wf-bar-active' : ''}`}
          style={{
            '--wf-peak': bar.peak,
            animationDelay: `${i * BAR_DELAY}s`,
          } as React.CSSProperties}
        />
      ))}
    </svg>
  )
}
