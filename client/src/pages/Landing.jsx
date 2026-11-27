import { useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Logo } from '../components/Layout.jsx';
import { useAuth } from '../state/auth.jsx';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Full-bleed SVG scene: kitchen surplus moving across Dhaka to a shelter. */
function HeroScene() {
  return (
    <svg className="hero-scene h-full w-full" viewBox="0 0 960 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#0b3d2e" />
          <stop offset="55%" stopColor="#065f46" />
          <stop offset="100%" stopColor="#134e3a" />
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="road" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <rect width="960" height="720" fill="url(#sky)" />
      <ellipse className="hero-glow" cx="180" cy="520" rx="220" ry="160" fill="url(#glow)" />

      {/* Distant city silhouette */}
      <g className="hero-skyline" fill="#043d2e" opacity="0.55">
        <rect x="40" y="280" width="48" height="160" rx="2" />
        <rect x="100" y="240" width="36" height="200" rx="2" />
        <rect x="148" y="300" width="70" height="140" rx="2" />
        <rect x="230" y="260" width="44" height="180" rx="2" />
        <rect x="290" y="310" width="56" height="130" rx="2" />
        <rect x="620" y="270" width="60" height="170" rx="2" />
        <rect x="700" y="230" width="40" height="210" rx="2" />
        <rect x="760" y="290" width="80" height="150" rx="2" />
        <rect x="860" y="250" width="50" height="190" rx="2" />
      </g>

      {/* Route path */}
      <path
        className="hero-route"
        d="M160 480 C 280 420, 360 560, 480 480 S 700 400, 800 460"
        fill="none"
        stroke="url(#road)"
        strokeWidth="3"
        strokeDasharray="10 12"
        strokeLinecap="round"
      />

      {/* Kitchen block */}
      <g className="hero-kitchen" transform="translate(90 400)">
        <rect x="0" y="40" width="140" height="100" rx="10" fill="#ecfdf5" />
        <rect x="0" y="40" width="140" height="28" rx="10" fill="#f59e0b" />
        <rect x="0" y="58" width="140" height="10" fill="#f59e0b" />
        <text x="70" y="58" textAnchor="middle" fill="#064e3b" fontSize="13" fontWeight="700" fontFamily="Syne, sans-serif">
          Kitchen
        </text>
        <circle cx="36" cy="100" r="10" fill="#065f46" />
        <circle cx="70" cy="100" r="10" fill="#047857" />
        <circle cx="104" cy="100" r="10" fill="#f59e0b" />
      </g>

      {/* Moving plate along the route */}
      <g className="hero-plate" transform="translate(160 480)">
        <circle r="22" fill="#fff7ed" stroke="#f59e0b" strokeWidth="3" />
        <circle r="12" fill="#fbbf24" opacity="0.85" />
        <circle cx="-4" cy="-3" r="3.5" fill="#065f46" />
        <circle cx="5" cy="2" r="2.8" fill="#047857" />
      </g>

      {/* Courier */}
      <g className="hero-courier" transform="translate(470 455)">
        <circle r="16" fill="#fef3c7" stroke="#065f46" strokeWidth="2.5" />
        <path d="M-18 8 h36" stroke="#065f46" strokeWidth="3" strokeLinecap="round" />
        <circle cx="-14" cy="14" r="5" fill="none" stroke="#065f46" strokeWidth="2" />
        <circle cx="14" cy="14" r="5" fill="none" stroke="#065f46" strokeWidth="2" />
      </g>

      {/* Shelter block */}
      <g className="hero-shelter" transform="translate(730 400)">
        <rect x="0" y="40" width="150" height="100" rx="10" fill="#ecfdf5" />
        <path d="M-8 48 L75 8 L158 48 Z" fill="#065f46" />
        <text x="75" y="78" textAnchor="middle" fill="#064e3b" fontSize="13" fontWeight="700" fontFamily="Syne, sans-serif">
          Shelter
        </text>
        <rect x="55" y="92" width="40" height="48" rx="4" fill="#f59e0b" />
      </g>

      {/* Floating steam / particles */}
      <g className="hero-steam" fill="#fef3c7" opacity="0.55">
        <circle className="steam" cx="150" cy="390" r="4" />
        <circle className="steam" cx="175" cy="370" r="3" />
        <circle className="steam" cx="200" cy="395" r="3.5" />
        <circle className="steam" cx="480" cy="430" r="3" />
        <circle className="steam" cx="520" cy="410" r="2.5" />
        <circle className="steam" cx="780" cy="380" r="3.5" />
      </g>
    </svg>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Kitchens post surplus',
    body: 'A restaurant or hall lists leftover meals with a hard safe-until deadline. The feed updates the moment it goes live.',
  },
  {
    n: '02',
    title: 'NGOs claim what they can take',
    body: 'Nearby shelters see distance and capacity limits, then claim meals before the food expires.',
  },
  {
    n: '03',
    title: 'Volunteers close the loop',
    body: 'A volunteer collects with a handover code, delivers to the NGO, and every meal is counted in the impact ledger.',
  },
];

export default function Landing() {
  const root = useRef(null);
  const { config } = useAuth();

  useGSAP(
    () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduce) {
        gsap.set(
          ['.hero-brand', '.hero-letter', '.hero-line', '.hero-sub', '.hero-cta', '.hero-nav', '.hero-scene', '.lp-step', '.lp-flow-item', '.lp-cta-block > *'],
          { clearProps: 'all', opacity: 1 },
        );
        return;
      }

      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .from('.hero-nav > *', { y: -20, opacity: 0, duration: 0.55, stagger: 0.08 })
        .from('.hero-letter', { y: 48, opacity: 0, duration: 0.7, stagger: { each: 0.045, from: 'start' }, ease: 'power3.out' }, '-=0.25')
        .from('.hero-line', { y: 28, opacity: 0, duration: 0.7 }, '-=0.35')
        .from('.hero-sub', { y: 20, opacity: 0, duration: 0.6 }, '-=0.4')
        .from('.hero-cta a', { y: 18, opacity: 0, duration: 0.5, stagger: 0.12 }, '-=0.3')
        .from(
          ['.hero-skyline', '.hero-kitchen', '.hero-route', '.hero-courier', '.hero-shelter', '.hero-plate', '.hero-steam'],
          { opacity: 0, y: 24, duration: 0.7, stagger: 0.09, ease: 'power2.out' },
          0.2,
        );

      // Plate travels kitchen → shelter along the dashed route, then loops.
      gsap.fromTo(
        '.hero-plate',
        { x: 0, y: 0 },
        {
          keyframes: [
            { x: 160, y: -55, duration: 2.4, ease: 'sine.inOut' },
            { x: 320, y: 15, duration: 2.4, ease: 'sine.inOut' },
            { x: 500, y: -35, duration: 2.6, ease: 'sine.inOut' },
            { x: 640, y: -10, duration: 2.2, ease: 'sine.inOut' },
            { x: 0, y: 0, duration: 0.01 },
          ],
          repeat: -1,
          repeatDelay: 0.35,
        },
      );

      gsap.to('.hero-courier', {
        y: '+=8',
        duration: 1.6,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      });

      gsap.to('.hero-route', {
        strokeDashoffset: -44,
        duration: 2.8,
        repeat: -1,
        ease: 'none',
      });

      gsap.to('.steam', {
        y: -28,
        opacity: 0,
        duration: 2.4,
        stagger: { each: 0.35, repeat: -1 },
        ease: 'power1.out',
      });

      gsap.to('.hero-glow', {
        opacity: 0.55,
        scale: 1.08,
        transformOrigin: 'center',
        duration: 3.2,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      });

      // Scroll: section headers then staggered children
      gsap.from('.lp-how-head > *', {
        y: 36,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-section', start: 'top 78%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-step', {
        y: 56,
        opacity: 0,
        duration: 0.85,
        stagger: { each: 0.16, from: 'start' },
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-steps', start: 'top 82%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-flow-head > *', {
        y: 32,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-flow', start: 'top 78%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-flow-item', {
        y: 44,
        opacity: 0,
        duration: 0.75,
        stagger: { each: 0.14, from: 'start' },
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-flow-grid', start: 'top 80%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-cta-block > *', {
        y: 28,
        opacity: 0,
        duration: 0.65,
        stagger: { each: 0.1, from: 'start' },
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-cta-block', start: 'top 80%', toggleActions: 'play none none reverse' },
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="landing bg-[var(--lp-bg)] text-[var(--lp-ink)]">
      {/* —— Hero: one composition —— */}
      <header className="relative isolate min-h-[100svh] overflow-hidden">
        <div className="absolute inset-0">
          <HeroScene />
          <div className="absolute inset-0 bg-gradient-to-r from-[#042f24]/92 via-[#042f24]/72 to-[#042f24]/35" />
          <div className="pointer-events-none absolute inset-0 lp-grain" />
        </div>

        <nav className="hero-nav relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo light />
          <div className="flex items-center gap-3 text-sm">
            <Link to="/login" className="font-semibold text-white/90 underline-offset-4 hover:underline">
              Sign in
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-10 items-center rounded-lg bg-amber-400 px-4 py-2 font-semibold text-brand-900 transition hover:bg-amber-300"
            >
              Create account
            </Link>
          </div>
        </nav>

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-6xl flex-col justify-end px-5 pb-16 pt-10 sm:px-8 sm:pb-20 lg:justify-center lg:pb-24">
          <p className="hero-brand font-display text-5xl font-extrabold tracking-tight text-white sm:text-7xl lg:text-8xl" aria-label="RescuePlate">
            {'RescuePlate'.split('').map((ch, i) => (
              <span key={`${ch}${i}`} className="hero-letter inline-block">
                {ch}
              </span>
            ))}
          </p>
          <h1 className="hero-line mt-4 max-w-xl font-display text-2xl font-semibold leading-snug text-amber-200 sm:text-3xl lg:text-4xl">
            Surplus food, delivered before it expires.
          </h1>
          <p className="hero-sub mt-4 max-w-md text-base leading-relaxed text-brand-50/90 sm:text-lg">
            A live network connecting Dhaka kitchens to nearby NGOs — with volunteers on the route and a hard clock on every meal.
          </p>
          <div className="hero-cta mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="inline-flex min-h-12 items-center rounded-lg bg-white px-6 py-3 text-sm font-bold text-brand-900 transition hover:bg-amber-50"
            >
              {config?.demoMode ? 'Try the live demo' : 'Sign in'}
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-12 items-center rounded-lg border border-white/40 px-6 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white/10"
            >
              Join as a kitchen or NGO
            </Link>
          </div>
        </div>
      </header>

      {/* —— How it works —— */}
      <section className="lp-section mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28" aria-labelledby="how-title">
        <div className="lp-how-head">
          <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-brand-700">How it works</p>
          <h2 id="how-title" className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-brand-950 sm:text-4xl">
            Three moves. No food left waiting on a WhatsApp thread.
          </h2>
        </div>
        <ol className="lp-steps mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((s) => (
            <li key={s.n} className="lp-step">
              <span className="font-display text-4xl font-extrabold text-amber-500/90">{s.n}</span>
              <h3 className="mt-3 font-display text-xl font-bold text-brand-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* —— Live flow —— */}
      <section className="lp-flow border-y border-brand-900/10 bg-brand-900 text-brand-50" aria-labelledby="flow-title">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="lp-flow-head">
            <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-amber-300">Built for the last few hours</p>
            <h2 id="flow-title" className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Real-time claims. Hard food-safety clocks. No silent overwrites.
            </h2>
          </div>
          <div className="lp-flow-grid mt-14 grid gap-10 sm:grid-cols-3">
            {[
              { title: 'Live feed', body: 'Listings appear and update the second a kitchen posts or an NGO claims.' },
              { title: 'Fair capacity', body: 'Each NGO’s daily meal limit keeps one shelter from taking everything.' },
              { title: 'Mapped routes', body: 'OpenStreetMap pins show where to collect, where to deliver, and where you are.' },
            ].map((item) => (
              <div key={item.title} className="lp-flow-item">
                <h3 className="font-display text-lg font-bold text-amber-200">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-brand-100">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* —— Closing CTA —— */}
      <section className="lp-cta-block mx-auto max-w-6xl px-5 py-24 text-center sm:px-8 sm:py-32" aria-labelledby="cta-title">
        <p className="font-display text-5xl font-extrabold tracking-tight text-brand-900 sm:text-6xl" id="cta-title">
          RescuePlate
        </p>
        <p className="mx-auto mt-4 max-w-lg text-lg text-stone-600">
          Good food should reach people, not the bin. Start with a demo account or register your organization.
        </p>
        <p className="mt-2 font-medium text-brand-800" lang="bn">
          খাবার নষ্ট নয়, পৌঁছে যাক মানুষের কাছে
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex min-h-12 items-center rounded-lg bg-brand-800 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-900"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="inline-flex min-h-12 items-center rounded-lg border border-brand-800/30 px-6 py-3 text-sm font-bold text-brand-900 transition hover:bg-brand-50"
          >
            Create account
          </Link>
        </div>
        <p className="mt-16 text-xs text-stone-500">Hack the Vibe 2026 · World Problem Solver · UNEP Food Waste Index 2024</p>
      </section>
    </div>
  );
}
