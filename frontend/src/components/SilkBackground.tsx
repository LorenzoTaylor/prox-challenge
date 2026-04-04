export function SilkBackground() {
  return (
    <iframe
      src="/silk-bg.html"
      className="absolute inset-0 w-full h-full border-0 pointer-events-none"
      style={{
        maskImage: 'radial-gradient(ellipse 90% 42% at 50% 100%, black 0%, black 15%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 90% 42% at 50% 100%, black 0%, black 15%, transparent 100%)',
      }}
      title="background"
    />
  )
}
