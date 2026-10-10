/** Development placeholder: pages appear in the menu (for the right roles) before they are built. */
export function NotBuiltYetPage({ title, what }: { title: string; what: string }) {
  return (
    <section className="rounded-xl border border-line bg-white p-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-[15px] text-muted">This screen arrives with the {what} phase.</p>
    </section>
  );
}
