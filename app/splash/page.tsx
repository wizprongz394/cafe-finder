"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SplashScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<"fill" | "logo" | "tagline" | "done">("fill");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("logo"), 600);
    const t2 = setTimeout(() => setPhase("tagline"), 1600);
    const t3 = setTimeout(() => setPhase("done"), 3200);
    const t4 = setTimeout(() => router.push("/auth"), 3600);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, [router]);

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body { background: #FFECD1; overflow: hidden; }

        .splash {
          position: fixed; inset: 0;
          background: #FFECD1;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          font-family: 'DM Sans', sans-serif;
        }

        /* Chocolate fill from bottom */
        .choc-fill {
          position: absolute; inset: 0;
          background: #3E000C;
          transform: translateY(100%);
          animation: fillUp 1.1s cubic-bezier(0.76, 0, 0.24, 1) 0.1s forwards;
        }
        @keyframes fillUp {
          to { transform: translateY(0%); }
        }

        /* Coffee grain texture */
        .grain {
          position: absolute; inset: 0;
          opacity: 0.035;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          pointer-events: none;
        }

        .content {
          position: relative;
          z-index: 10;
          text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 0;
        }

        /* Coffee cup illustration */
        .cup-wrap {
          margin-bottom: 28px;
          opacity: 0;
          transform: translateY(12px) scale(0.92);
          transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .cup-wrap.visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        /* Steam animation */
        .steam path {
          stroke: #FFECD1;
          stroke-width: 2;
          fill: none;
          stroke-linecap: round;
          opacity: 0;
        }
        .cup-wrap.visible .steam path:nth-child(1) {
          animation: steamRise 2s ease-in-out 0.5s infinite;
        }
        .cup-wrap.visible .steam path:nth-child(2) {
          animation: steamRise 2s ease-in-out 0.8s infinite;
        }
        .cup-wrap.visible .steam path:nth-child(3) {
          animation: steamRise 2s ease-in-out 0.65s infinite;
        }
        @keyframes steamRise {
          0%   { opacity: 0; transform: translateY(0); }
          20%  { opacity: 0.7; }
          80%  { opacity: 0.3; }
          100% { opacity: 0; transform: translateY(-14px); }
        }

        /* Logo text */
        .logo {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-size: clamp(64px, 12vw, 96px);
          letter-spacing: 0.12em;
          color: #FFECD1;
          line-height: 1;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.9s ease 0.1s, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.1s;
        }
        .logo.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Divider line */
        .divider {
          width: 0;
          height: 1px;
          background: rgba(255,236,209,0.35);
          margin: 20px auto;
          transition: width 1.0s cubic-bezier(0.22, 1, 0.36, 1) 0.2s;
        }
        .divider.visible {
          width: 120px;
        }

        /* Tagline */
        .tagline {
          font-family: 'DM Sans', sans-serif;
          font-weight: 300;
          font-size: clamp(11px, 1.8vw, 13px);
          letter-spacing: 0.32em;
          color: rgba(255,236,209,0.55);
          text-transform: uppercase;
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 0.8s ease 0.3s, transform 0.8s ease 0.3s;
        }
        .tagline.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Corner decorations */
        .corner {
          position: absolute;
          width: 48px; height: 48px;
          opacity: 0;
          transition: opacity 1.2s ease 0.8s;
        }
        .corner.visible { opacity: 0.2; }
        .corner-tl { top: 32px; left: 32px; border-top: 1px solid #FFECD1; border-left: 1px solid #FFECD1; }
        .corner-br { bottom: 32px; right: 32px; border-bottom: 1px solid #FFECD1; border-right: 1px solid #FFECD1; }

        /* Loading dots */
        .loading-dots {
          position: absolute;
          bottom: 48px;
          display: flex; gap: 6px; align-items: center;
          opacity: 0;
          transition: opacity 0.6s ease;
        }
        .loading-dots.visible { opacity: 1; }
        .dot {
          width: 4px; height: 4px;
          border-radius: 50%;
          background: rgba(255,236,209,0.4);
          animation: dotPulse 1.4s ease-in-out infinite;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 0.8; }
        }

        /* Exit animation */
        .splash.exiting {
          animation: slideUp 0.5s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }
        @keyframes slideUp {
          to { transform: translateY(-100%); opacity: 0; }
        }
      `}</style>

      <div className={`splash ${phase === "done" ? "exiting" : ""}`}>
        <div className="grain" />
        <div className="choc-fill" />

        <div className={`corner corner-tl ${phase !== "fill" ? "visible" : ""}`} />
        <div className={`corner corner-br ${phase !== "fill" ? "visible" : ""}`} />

        <div className="content">
          <div className={`cup-wrap ${phase !== "fill" ? "visible" : ""}`}>
            <svg width="72" height="80" viewBox="0 0 72 80" fill="none">
              <g className="steam">
                <path d="M26 18 Q23 12 26 6" />
                <path d="M36 16 Q33 10 36 4" />
                <path d="M46 18 Q43 12 46 6" />
              </g>
              <path d="M12 26 L16 68 Q16 72 20 72 L52 72 Q56 72 56 68 L60 26 Z"
                    fill="none" stroke="#FFECD1" strokeWidth="1.5" strokeLinejoin="round"/>
              <rect x="10" y="22" width="52" height="6" rx="3"
                    fill="none" stroke="#FFECD1" strokeWidth="1.5"/>
              <path d="M56 34 Q70 34 70 46 Q70 58 56 58"
                    fill="none" stroke="#FFECD1" strokeWidth="1.5" strokeLinecap="round"/>
              <ellipse cx="36" cy="74" rx="28" ry="4"
                       fill="none" stroke="#FFECD1" strokeWidth="1.5"/>
            </svg>
          </div>

          <div className={`logo ${phase !== "fill" ? "visible" : ""}`}>
            EXPRESSO
          </div>

          <div className={`divider ${phase === "tagline" || phase === "done" ? "visible" : ""}`} />
          
          <div className={`tagline ${phase === "tagline" || phase === "done" ? "visible" : ""}`}>
            Find your next favourite spot
          </div>
        </div>

        <div className={`loading-dots ${phase === "tagline" || phase === "done" ? "visible" : ""}`}>
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
        </div>
      </div>
    </>
  );
}