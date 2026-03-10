import React from "react";

const FeatureCard = ({ icon, title, description }) => (
  <div className="p-10 bg-brand-card border border-brand-border hover:border-brand-accent transition-all duration-500 group relative overflow-hidden">
    <div className="absolute top-0 left-0 w-1 h-0 bg-brand-accent group-hover:h-full transition-all duration-500"></div>
    <div className="w-14 h-14 bg-brand-accent text-brand-bg flex items-center justify-center mb-10 group-hover:scale-110 transition-transform shadow-lg">
      {icon}
    </div>
    <h3 className="font-geom text-2xl font-black text-brand-text mb-4 uppercase tracking-tighter italic group-hover:text-brand-accent transition-colors">
      {title}
    </h3>
    <p className="font-sans text-brand-text-muted leading-relaxed font-medium italic">
      {description}
    </p>
  </div>
);

const Features = () => {
  const features = [
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
      title: "Reasoning Loop",
      description:
        "Nova uses a strict OODA Loop (Observe, Orient, Decide, Act) to plan and self-correct during complex multi-step tasks.",
    },
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 012-2M5 11V9a2 2 0 01-2-2m0 0V5a2 2 0 012-2h14a2 2 0 012 2v2M5 7h14"
          />
        </svg>
      ),
      title: "Human-Readable Memory",
      description:
        "No black-box databases. All memory is stored in plain-text Markdown files that you can audit, edit, and own.",
    },
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7zM9 9h6M9 13h6M9 17h3"
          />
        </svg>
      ),
      title: "Parallel Execution",
      description:
        "Tools run in isolated worker threads. Nova can browse, read, and call APIs simultaneously for maximum performance.",
    },
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      ),
      title: "Security-First",
      description:
        "Capability-based permission system with optional manual approval for high-risk actions like sending emails or system changes.",
    },
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
          />
        </svg>
      ),
      title: "Web Intelligence",
      description:
        "Autonomous browsing with visual analysis. Nova 'sees' the page to understand layouts and find interactive elements.",
    },
    {
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
          />
        </svg>
      ),
      title: "Google Workspace",
      description:
        "Deep integration with Gmail, Calendar, and Drive. Read, search, and manage your digital life autonomously.",
    },
  ];

  return (
    <section
      id="features"
      className="py-32 px-6 bg-brand-bg border-t border-brand-border"
    >
      <div className="max-w-7xl mx-auto">
        <div className="mb-24 text-center md:text-left">
          <h2 className="font-geom text-6xl md:text-7xl font-black text-brand-text mb-8 uppercase tracking-tightest italic leading-[0.8]">
            CORE <span className="text-brand-accent">POWER</span>
            <span className="text-brand-text">.</span>
          </h2>
          <p className="font-sans text-brand-text-muted text-xl mb-16 leading-relaxed font-medium italic opacity-80 max-w-2xl">
            A modular engine built for sovereignty. No cloud dependencies. No
            compromises.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border border-brand-border">
          {features.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
