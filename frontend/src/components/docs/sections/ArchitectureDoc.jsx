import React from "react";

const ArchitectureDoc = () => (
  <div className="prose prose-invert prose-emerald max-w-none font-sans">
    <h1 className="font-geom text-5xl md:text-7xl font-black mb-12 text-brand-text leading-none uppercase italic tracking-tightest">
      Architecture <span className="text-brand-accent">Deep Dive</span>
    </h1>
    <p className="font-sans text-xl text-brand-text-muted mb-20 leading-relaxed font-medium italic max-w-3xl">
      Nova is engineered for local-first sovereignty and high-concurrency tool
      execution. Highly modular, horizontally scalable.
    </p>

    <div className="bg-brand-card border border-brand-border p-12 mb-20 flex flex-col items-center shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-accent/5 blur-[100px] rounded-full"></div>
      <div className="flex flex-col md:flex-row gap-8 w-full max-w-3xl relative">
        <div className="flex-1 p-6 bg-brand-bg border border-brand-border text-center group hover:border-brand-accent transition-colors">
          <div className="text-[10px] text-brand-text-muted uppercase tracking-[0.3em] mb-4 font-black opacity-40">
            Channels
          </div>
          <div className="text-xs text-brand-text italic font-medium">
            Telegram / WS / CLI
          </div>
        </div>
        <div className="flex-1 p-6 bg-brand-card border border-brand-accent/30 text-center relative group">
          <div className="absolute inset-0 bg-brand-accent/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="text-[10px] text-brand-text-muted uppercase tracking-[0.3em] mb-4 font-black opacity-40">
            Gateway
          </div>
          <div className="text-xs text-brand-accent font-black uppercase italic">
            Fastify Server
          </div>
        </div>
        <div className="flex-1 p-6 bg-brand-accent text-brand-bg border-4 border-brand-bg text-center shadow-[10px_10px_0px_0px_rgba(16,185,129,0.1)]">
          <div className="text-[10px] uppercase tracking-[0.4em] mb-4 font-black">
            Agent
          </div>
          <div className="text-xs font-black italic uppercase">
            Reasoning Engine
          </div>
        </div>
      </div>
      <div className="h-12 w-px bg-brand-border my-2 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-brand-accent rounded-full animate-ping"></div>
      </div>
      <div className="w-full max-w-sm p-8 bg-brand-card/50 backdrop-blur-md border border-brand-border text-center shadow-2xl">
        <div className="text-[10px] text-brand-text-muted uppercase tracking-[0.4em] mb-6 font-black opacity-40">
          Runtime (Piscina)
        </div>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-5 h-5 bg-brand-accent/20 border border-brand-accent/40 animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            ></div>
          ))}
        </div>
      </div>
    </div>

    <h3 className="text-xl font-bold text-white mb-4">1. The Channel Layer</h3>
    <p className="text-gray-400 mb-8 leading-relaxed">
      Incoming messages land in the **Gateway** via the **WebSocketServer** or
      the **TelegramChannel**. Both route directly into `ChatService`, which
      manages the user's session state and history.
    </p>

    <h3 className="text-xl font-bold text-white mb-4">
      2. The Brain — Research Orchestrator
    </h3>
    <p className="text-gray-400 mb-8 leading-relaxed">
      The Orchestrator manages the OODA reasoning loop and handles recursive
      tool calls. It injects relevant memory context from the **MarkdownMemory**
      store into every reasoning turn.
    </p>

    <h3 className="text-xl font-bold text-white mb-4">
      3. Scaling with Piscina
    </h3>
    <p className="text-gray-400 mb-8 leading-relaxed">
      To prevent blocking the event loop during heavy computational tasks (like
      vision analysis or long-running shell scripts), Nova uses an isolated
      worker pool powered by **Piscina**.
    </p>

    <div className="mt-20 p-10 bg-brand-card/50 border border-brand-accent/20 relative group">
      <div className="absolute top-0 left-0 w-2 h-full bg-brand-accent/20"></div>
      <h4 className="text-[10px] font-black text-brand-accent uppercase tracking-[0.4em] mb-4">
        Isolation_Protocol
      </h4>
      <p className="text-xs text-brand-text-muted font-medium italic leading-relaxed">
        For critical operations, Nova can execute logic within an
        <span className="text-brand-text px-1 font-black not-italic">
          Isolated-VM
        </span>
        , providing an extra layer of sandboxing for unknown code.
      </p>
    </div>
  </div>
);

export default ArchitectureDoc;
