export default function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!open}
      className={`overflow-hidden transition-all duration-150 ease-out ${open ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0"}`}
    >
      {children}
    </div>
  );
}
