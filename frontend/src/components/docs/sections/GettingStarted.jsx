import React from "react";

const GettingStarted = () => (
  <div className="prose prose-invert prose-emerald max-w-none">
    <h2 className="font-geom text-5xl font-black text-brand-text mb-12 uppercase tracking-tighter italic leading-none">
      Getting <span className="text-brand-accent">Started</span>
    </h2>

    <div className="space-y-12 mb-16">
      <section>
        <div className="flex items-center space-x-6 mb-8 group">
          <div className="w-14 h-14 bg-brand-accent flex items-center justify-center font-black text-brand-bg text-xl group-hover:rotate-12 transition-transform shadow-lg">
            01
          </div>
          <h3 className="font-geom text-3xl font-black text-brand-text uppercase italic tracking-tighter">
            Installation
          </h3>
        </div>
        <p className="font-sans text-brand-text-muted mb-8 font-medium italic leading-relaxed">
          Install the Nova CLI globally using npm. This gives you access to the{" "}
          <code className="font-mono text-brand-accent font-black italic px-2">
            novaa
          </code>{" "}
          command.
        </p>
        <div className="bg-brand-card p-10 border-l-8 border-brand-accent font-mono text-brand-accent font-black text-lg shadow-inner">
          npm install -g novaa-agent
        </div>
      </section>

      <section>
        <div className="flex items-center space-x-6 mb-8 group">
          <div className="w-14 h-14 bg-brand-text flex items-center justify-center font-black text-brand-bg text-xl group-hover:rotate-12 transition-transform shadow-lg">
            02
          </div>
          <h3 className="font-geom text-3xl font-black text-brand-text uppercase italic tracking-tighter">
            Initialization
          </h3>
        </div>
        <p className="font-sans text-brand-text-muted mb-8 font-medium italic leading-relaxed">
          Run the interactive setup wizard to configure your AI engine and API
          keys.
        </p>
        <div className="bg-brand-card p-10 border-l-8 border-brand-text font-mono text-brand-text font-black text-lg shadow-inner">
          nova init
        </div>
      </section>

      <section>
        <div className="flex items-center space-x-6 mb-8 group">
          <div className="w-14 h-14 bg-brand-text-muted flex items-center justify-center font-black text-brand-bg text-xl group-hover:rotate-12 transition-transform shadow-lg">
            03
          </div>
          <h3 className="font-geom text-3xl font-black text-brand-text uppercase italic tracking-tighter">
            Start the Daemon
          </h3>
        </div>
        <p className="font-sans text-brand-text-muted mb-8 font-medium italic leading-relaxed">
          Nova relies on a background service called the "Daemon" to handle
          scheduled jobs and research tasks.
        </p>
        <div className="bg-brand-card p-10 border-l-8 border-brand-text-muted font-mono text-brand-text-muted font-black text-lg shadow-inner">
          nova daemon start
        </div>
      </section>
    </div>

    <div className="mt-24 p-12 bg-brand-card border border-brand-border relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-brand-accent/5 blur-3xl rounded-full"></div>
      <h4 className="font-geom text-3xl font-black mb-10 italic text-brand-text uppercase tracking-tighter leading-none">
        Recommended <span className="text-brand-accent">Engines</span>
      </h4>
      <ul className="space-y-6 font-sans font-black text-brand-text-muted uppercase tracking-widest text-xs italic">
        <li className="flex items-center space-x-4">
          <div className="w-3 h-3 bg-brand-accent"></div>
          <span>Anthropic Claude 3.5 Sonnet (Optimized for OODA)</span>
        </li>
        <li className="flex items-center space-x-4">
          <div className="w-3 h-3 bg-brand-text"></div>
          <span>OpenAI GPT-4o (Superior Tool Selection)</span>
        </li>
      </ul>
    </div>
  </div>
);

export default GettingStarted;
