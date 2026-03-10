import React from "react";
import { Link } from "react-router-dom";

const Navbar = () => {
  return (
    <nav className="fixed top-0 w-full z-50 px-8 py-5 flex justify-end">
      <div className="flex items-center space-x-6">
        <Link
          to="/docs"
          className="bg-brand-text text-brand-bg px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-brand-accent hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all italic backdrop-blur-md"
        >
          Open_Docs
        </Link>
      </div>
    </nav>
  );
};

export default Navbar;
