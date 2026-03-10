import React from "react";

const FeaturesDoc = () => (
  <div className="prose prose-invert prose-emerald max-w-none">
    <h1 className="font-geom text-5xl md:text-7xl font-black mb-12 text-brand-text leading-none uppercase italic tracking-tightest">
      Key <span className="text-brand-accent">Capabilities</span>
    </h1>

    <div className="space-y-12">
      <section>
        <h2 className="font-geom text-3xl font-black text-brand-accent mb-6 uppercase italic tracking-tighter">
          🧠 OODA Reasoning Loop
        </h2>
        <p className="text-brand-text-muted leading-relaxed mb-8 italic font-medium">
          The heart of Nova's intelligence. Every request triggers a four-phase
          reasoning cycle:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="p-6 bg-brand-card border border-brand-border group hover:border-brand-accent transition-colors">
            <div className="text-brand-text font-black mb-3 italic uppercase tracking-widest text-xs group-hover:text-brand-accent transition-colors">
              Observe
            </div>
            <p className="text-xs text-brand-text-muted font-medium italic">
              Collects context, assesses tone, and identifies unknowns.
            </p>
          </div>
          <div className="p-6 bg-brand-card border border-brand-border group hover:border-brand-accent transition-colors">
            <div className="text-brand-text font-black mb-3 italic uppercase tracking-widest text-xs group-hover:text-brand-accent transition-colors">
              Orient
            </div>
            <p className="text-xs text-brand-text-muted font-medium italic">
              Calculates intent, assesses risk, and chooses tools.
            </p>
          </div>
          <div className="p-6 bg-brand-card border border-brand-border group hover:border-brand-accent transition-colors">
            <div className="text-brand-text font-black mb-3 italic uppercase tracking-widest text-xs group-hover:text-brand-accent transition-colors">
              Decide
            </div>
            <p className="text-xs text-brand-text-muted font-medium italic">
              Formulates a specific strategy and response type.
            </p>
          </div>
          <div className="p-6 bg-brand-card border border-brand-border group hover:border-brand-accent transition-colors">
            <div className="text-brand-text font-black mb-3 italic uppercase tracking-widest text-xs group-hover:text-brand-accent transition-colors">
              Act
            </div>
            <p className="text-xs text-brand-text-muted font-medium italic">
              Executes the plan, often involving multiple tools in parallel.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-geom text-3xl font-black text-brand-accent mb-6 uppercase italic tracking-tighter">
          ⚡ Parallel Execution
        </h2>
        <p className="text-brand-text-muted leading-relaxed mb-4 italic font-medium">
          Nova utilizes{" "}
          <span className="text-brand-text font-black not-italic px-2 bg-brand-accent/10">
            Piscina
          </span>{" "}
          to manage a pool of worker threads. Tools like{" "}
          <code className="text-brand-accent font-black">web_search</code> and{" "}
          <code className="text-brand-accent font-black">browse</code> can run
          concurrently, significantly reducing the "time to response" for
          complex multi-source research tasks.
        </p>
      </section>

      <section>
        <h2 className="font-geom text-3xl font-black text-brand-accent mb-6 uppercase italic tracking-tighter">
          🤖 Sub-Agent Delegation
        </h2>
        <p className="text-brand-text-muted leading-relaxed mb-8 italic font-medium">
          During the Orient phase, Nova can decide to delegate specific
          sub-tasks to specialized sub-agents:
        </p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0">
          <li className="bg-brand-card border border-brand-border px-6 py-4 flex items-center group transition-all hover:translate-x-2">
            <span className="text-brand-accent font-black mr-3 italic group-hover:scale-110 transition-transform">
              Researcher:
            </span>
            <span className="text-xs text-brand-text-muted font-medium">
              Deep factual probes
            </span>
          </li>
          <li className="bg-brand-card border border-brand-border px-6 py-4 flex items-center group transition-all hover:translate-x-2">
            <span className="text-brand-text font-black mr-3 italic group-hover:scale-110 transition-transform">
              Coder:
            </span>
            <span className="text-xs text-brand-text-muted font-medium">
              Software engineering tasks
            </span>
          </li>
          <li className="bg-brand-card border border-brand-border px-6 py-4 flex items-center group transition-all hover:translate-x-2">
            <span className="text-brand-text font-black mr-3 italic group-hover:scale-110 transition-transform">
              Analyst:
            </span>
            <span className="text-xs text-brand-text-muted font-medium">
              Data processing focus
            </span>
          </li>
          <li className="bg-brand-card border border-brand-border px-6 py-4 flex items-center group transition-all hover:translate-x-2">
            <span className="text-brand-accent font-black mr-3 italic group-hover:scale-110 transition-transform">
              Communicator:
            </span>
            <span className="text-xs text-brand-text-muted font-medium">
              Outreach & Triage
            </span>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="font-geom text-3xl font-black text-brand-accent mb-6 uppercase italic tracking-tighter">
          💓 Proactive Heartbeat
        </h2>
        <p className="text-brand-text-muted leading-relaxed mb-4 italic font-medium">
          The{" "}
          <span className="text-brand-text font-black italic">
            Heartbeat Engine
          </span>{" "}
          runs tasks on a schedule. Nova can "wake up" to check your emails,
          summarize your morning calendar, or check-in on status updates without
          needing a user prompt.
        </p>
      </section>
    </div>
  </div>
);

export default FeaturesDoc;
