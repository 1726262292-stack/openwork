export function LandingBackground() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 bg-[#f6f7f3]" />
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-24 h-64 w-64 rounded-full bg-[#dbe7e1]/70 blur-3xl" />
        <div className="absolute right-[-6rem] top-40 h-72 w-72 rounded-full bg-[#e8ddd2]/75 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[#dde5ef]/80 blur-3xl" />
      </div>
    </>
  );
}
