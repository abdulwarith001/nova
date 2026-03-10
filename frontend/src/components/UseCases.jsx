import React, { useState } from "react";

const UseCases = () => {
  const [activeTab, setActiveTab] = useState(0);

  const cases = [
    {
      title: "Web Research",
      description:
        "Nova can execute semantic searches, browse multiple sites, and synthesize a deep report with full citations.",
      example:
        "Research the latest news on AI regulations in the EU and save a summary to my Drive.",
      tools: ["web_search", "browse", "drive_upload"],
    },
    {
      title: "Email Triage",
      description:
        "Automatically read unread emails, draft context-aware responses, and archive or flag urgent threads.",
      example:
        "Read my latest email from Sarah, check my calendar for availability, and draft a reply.",
      tools: ["gmail_read", "calendar_list", "gmail_draft"],
    },
    {
      title: "Code Intelligence",
      description:
        "Run shell commands, read logs, and edit files to debug complex project issues autonomously.",
      example:
        "Review auth.js and find why the JWT token is expiring early. Fix it and run the tests.",
      tools: ["bash", "read", "write"],
    },
  ];

  return (
    <section
      id="use-cases"
      className="py-48 px-6 bg-brand-card relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-accent/5 blur-[120px] rounded-full -z-10 translate-x-1/2"></div>
      <div className="max-w-7xl mx-auto">
        <h2 className="font-geom text-6xl md:text-8xl font-black text-brand-text text-center mb-24 uppercase tracking-tightest italic leading-[0.8]">
          OPERATIONAL <br />
          <span className="text-brand-accent">SCENARIOS</span>
        </h2>

        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-1/3 flex flex-col space-y-6">
            {cases.map((c, i) => (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`p-12 text-left border-l-4 transition-all duration-500 relative group ${activeTab === i ? "bg-brand-accent text-brand-bg border-brand-accent shadow-2xl" : "bg-brand-bg/50 border-brand-border hover:bg-brand-accent/5 text-brand-text-muted"}`}
              >
                <div
                  className={`font-geom text-2xl font-black mb-3 uppercase tracking-tighter italic ${activeTab === i ? "text-brand-bg" : "text-brand-text"}`}
                >
                  {c.title}
                </div>
                <p
                  className={`font-sans text-xs font-semibold italic ${activeTab === i ? "text-brand-bg/70" : "text-brand-text-muted/60"}`}
                >
                  {c.description.substring(0, 80)}...
                </p>
              </button>
            ))}
          </div>

          <div className="lg:w-2/3 bg-brand-card border border-brand-border p-10 md:p-16 relative group shadow-2xl">
            <div className="flex items-center space-x-6 mb-12">
              <div className="w-16 h-16 bg-brand-accent text-brand-bg flex items-center justify-center shadow-lg">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
              </div>
              <h3 className="font-geom text-5xl font-black text-brand-text uppercase tracking-tighter italic">
                {cases[activeTab].title}
              </h3>
            </div>

            <p className="font-sans text-2xl text-brand-text-muted mb-16 leading-relaxed font-medium italic">
              {cases[activeTab].description}
            </p>

            <div className="mb-16">
              <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-[4px] mb-8 border-b border-brand-border pb-3">
                PROMPT_MANIFEST
              </div>
              <div className="bg-brand-bg p-10 border-l-8 border-brand-accent font-mono text-brand-accent text-2xl font-bold italic shadow-inner">
                "{cases[activeTab].example}"
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              {cases[activeTab].tools.map((t, i) => (
                <span
                  key={i}
                  className="px-6 py-2 bg-brand-bg border border-brand-border text-[10px] font-black font-mono text-brand-text-muted uppercase tracking-widest hover:border-brand-accent transition-colors cursor-default"
                >
                  {t}()
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default UseCases;
