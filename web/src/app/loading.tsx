import Image from "next/image";

export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite" className="route-loading" role="status">
      <section className="route-loading-card">
        <div className="route-loading-brand">
          <Image
            alt=""
            height={54}
            priority
            src="/positive-solutions-logo.png"
            unoptimized
            width={54}
          />
          <div>
            <strong>Positive Solutions</strong>
            <span>Rehab Center</span>
          </div>
        </div>
        <div aria-hidden="true" className="route-loading-skeleton">
          <span className="route-loading-heading" />
          <span />
          <span />
          <span className="route-loading-progress" />
        </div>
        <span className="sr-only">Loading clinic workspace</span>
      </section>
    </main>
  );
}
