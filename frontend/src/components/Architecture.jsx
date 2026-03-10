import React from "react";

const Architecture = () => {
  return (
    <section className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="font-geom text-6xl md:text-8xl font-black text-brand-text mb-6 uppercase tracking-tighter italic leading-none">
            BUILT FOR <span className="text-brand-accent">SCALE</span>
          </h2>
          <p className="font-sans text-brand-text-muted max-w-2xl mx-auto font-medium italic">
            Nova's modular architecture ensures safety, performance, and
            cross-channel availability.
          </p>
        </div>

        <div className="relative p-12 bg-black border border-brand-border overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-brand-accent/5 blur-[100px] -z-10"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative font-sans">
            <div className="space-y-6">
              <div className="p-8 bg-brand-card border border-white/5 text-center">
                <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-widest mb-6">
                  CHANNEL_LAYER
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 bg-white/5 border border-white/5 text-[10px] text-gray-400 font-bold font-mono">
                    TG
                  </div>
                  <div className="p-3 bg-white/5 border border-white/5 text-[10px] text-gray-400 font-bold font-mono">
                    WS
                  </div>
                  <div className="p-3 bg-white/5 border border-white/5 text-[10px] text-gray-400 font-bold font-mono">
                    CLI
                  </div>
                </div>
              </div>
              <div className="flex justify-center">
                <svg
                  className="w-8 h-8 text-brand-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
              </div>
              <div className="p-8 bg-brand-card border border-white/5 text-center">
                <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-widest mb-6">
                  GATEWAY_API
                </div>
                <div className="text-sm font-black text-brand-text italic uppercase tracking-tighter">
                  Fastify / WebSocket
                </div>
              </div>
            </div>

            <div className="p-10 bg-brand-accent text-brand-bg border border-black flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-brand-bg text-brand-accent flex items-center justify-center mb-8 shadow-xl">
                <svg
                  className="w-10 h-10"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.364-6.364l-.707-.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M12 7a5 5 0 015 5 5 5 0 01-5 5 5 5 0 01-5-5 5 5 0 015-5z"
                  />
                </svg>
              </div>
              <h4 className="font-geom text-3xl font-black mb-2 uppercase italic tracking-tighter text-brand-bg">
                REASONING_ENGINE
              </h4>
              <p className="font-mono text-[10px] font-black uppercase tracking-[3px] opacity-60 text-brand-bg">
                OODA LOOP ORCHESTRATOR
              </p>

              <div className="mt-12 w-full space-y-3">
                <div className="h-2 w-full bg-black/20 overflow-hidden">
                  <div className="h-full w-2/3 bg-black"></div>
                </div>
                <div className="font-mono text-[10px] font-black uppercase tracking-widest">
                  Processing Intent...
                </div>
              </div>
            </div>

            <div className="space-y-6 flex flex-col justify-center">
              <div className="p-8 bg-brand-card border border-brand-border">
                <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-widest mb-6">
                  TOOL_RUNTIME
                </div>
                <div className="flex items-center space-x-4 mb-4">
                  <div className="w-3 h-3 bg-brand-accent"></div>
                  <span className="text-xs text-brand-text font-mono font-bold">
                    Piscina Worker Pool
                  </span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="w-3 h-3 bg-brand-accent"></div>
                  <span className="text-xs text-brand-text font-mono font-bold">
                    Isolated Logic (IVM)
                  </span>
                </div>
              </div>
              <div className="p-8 bg-brand-card border border-brand-border">
                <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-widest mb-6">
                  SOVEREIGN_MEMORY
                </div>
                <div className="flex items-center space-x-4">
                  <svg
                    className="w-5 h-5 text-brand-accent"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M13 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V9l-7-7zm0 9V3.5L18.5 9H13z" />
                  </svg>
                  <span className="text-xs text-brand-text font-bold uppercase italic font-sans tracking-tight">
                    Markdown Store
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Architecture;
