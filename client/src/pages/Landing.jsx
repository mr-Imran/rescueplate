import { useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Logo } from '../components/Layout.jsx';
import { useAuth } from '../state/auth.jsx';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const HERO_IMG =
  'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=2000&q=80';

const STRIPS = [
  {
    src: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=800&q=80',
    label: 'Kitchen surplus',
  },
  {
    src: 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?auto=format&fit=crop&w=800&q=80',
    label: 'Ready to move',
  },
  {
    src: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=800&q=80',
    label: 'Volunteer route',
  },
  {
    src: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=800&q=80',
    label: 'Shared plates',
  },
  {
    src: 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?auto=format&fit=crop&w=800&q=80',
    label: 'Shelter tables',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Post surplus',
    body: 'Kitchens list leftover meals with a hard safe-until time. The feed updates the moment food goes live.',
  },
  {
    n: '02',
    title: 'Claim nearby',
    body: 'NGOs see distance and capacity, then claim what they can take before the food expires.',
  },
  {
    n: '03',
    title: 'Deliver fast',
    body: 'Volunteers collect with a handover code, follow the map, and close the loop at the shelter.',
  },
];

export default function Landing() {
  const root = useRef(null);
  const { config } = useAuth();

  useGSAP(
    () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) {
        gsap.set('.lp-anim', { clearProps: 'all', opacity: 1, y: 0 });
        return;
      }

      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .from('.lp-nav', { y: -28, opacity: 0, duration: 0.7 })
        .from('.lp-hero-media', { scale: 1.08, opacity: 0, duration: 1.35, ease: 'power2.out' }, 0)
        .from('.lp-brand-letter', { y: 56, opacity: 0, duration: 0.75, stagger: 0.04 }, 0.25)
        .from('.lp-hero-line', { y: 32, opacity: 0, duration: 0.7 }, '-=0.35')
        .from('.lp-hero-sub', { y: 22, opacity: 0, duration: 0.6 }, '-=0.4')
        .from('.lp-hero-cta a', { y: 18, opacity: 0, duration: 0.5, stagger: 0.12 }, '-=0.3')
        .from('.lp-scroll-hint', { opacity: 0, y: 10, duration: 0.5 }, '-=0.1');

      gsap.from('.lp-journey-copy > *', {
        y: 36,
        opacity: 0,
        duration: 0.75,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '#journey', start: 'top 75%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-strip', {
        y: 80,
        opacity: 0,
        duration: 0.9,
        stagger: { each: 0.1, from: 'center' },
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-strips', start: 'top 78%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-how-copy > *', {
        y: 36,
        opacity: 0,
        duration: 0.75,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '#how', start: 'top 75%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-step', {
        y: 50,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-steps', start: 'top 80%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-stat', {
        y: 40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-stats', start: 'top 80%', toggleActions: 'play none none reverse' },
      });

      gsap.from('.lp-close > *', {
        y: 28,
        opacity: 0,
        duration: 0.65,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.lp-close', start: 'top 82%', toggleActions: 'play none none reverse' },
      });

      // Slow vertical drift on strips while in view
      gsap.utils.toArray('.lp-strip-img').forEach((img, i) => {
        gsap.to(img, {
          yPercent: i % 2 === 0 ? -6 : 6,
          ease: 'none',
          scrollTrigger: {
            trigger: '.lp-strips',
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="landing font-sans text-stone-900">
      {/* —— Hero: full-bleed photo, brand first —— */}
      <header className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-brand-950 text-white">
        <div className="lp-hero-media absolute inset-0">
          <img src={HERO_IMG} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-brand-950/70 via-brand-950/55 to-brand-950/85" />
          <div className="pointer-events-none absolute inset-0 lp-grain opacity-30" />
        </div>

        <nav className="lp-nav lp-anim relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo light />
          <div className="flex items-center gap-4 text-sm">
            <a href="#how" className="hidden font-semibold text-white/80 underline-offset-4 hover:text-white hover:underline sm:inline">
              How it works
            </a>
            <Link to="/login" className="font-semibold text-white/90 underline-offset-4 hover:underline">
              Sign in
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-10 items-center rounded-md bg-white px-4 py-2 font-bold text-brand-950 transition hover:bg-amber-100"
            >
              Join
            </Link>
          </div>
        </nav>

        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 pb-24 pt-10 text-center sm:px-8">
          <p className="lp-anim font-display text-[clamp(2.75rem,10vw,6.5rem)] font-extrabold leading-[0.95] tracking-tight" aria-label="RescuePlate">
            {'RescuePlate'.split('').map((ch, i) => (
              <span key={`${ch}${i}`} className="lp-brand-letter inline-block">
                {ch}
              </span>
            ))}
          </p>
          <h1 className="lp-hero-line lp-anim mt-6 max-w-2xl font-display text-2xl font-semibold leading-snug text-amber-200 sm:text-3xl md:text-4xl">
            Surplus food, delivered before it expires.
          </h1>
          <p className="lp-hero-sub lp-anim mt-5 max-w-lg text-base leading-relaxed text-white/85 sm:text-lg">
            A live network moving meals from Dhaka kitchens to nearby NGOs — with volunteers on the route and a hard clock on every plate.
          </p>
          <div className="lp-hero-cta lp-anim mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="inline-flex min-h-12 items-center rounded-md bg-white px-7 py-3 text-sm font-bold text-brand-950 transition hover:bg-amber-50"
            >
              {config?.demoMode ? 'Try the live demo' : 'Sign in'}
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-12 items-center rounded-md border border-white/50 px-7 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white/10"
            >
              Register your organization
            </Link>
          </div>
        </div>

        <a
          href="#journey"
          className="lp-scroll-hint lp-anim absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
        >
          Scroll
        </a>
      </header>

      {/* —— Journey strips (Kindness-style staggered panels) —— */}
      <section id="journey" className="bg-[#f3f1ec] px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="journey-title">
        <div className="mx-auto max-w-6xl">
          <div className="lp-journey-copy mx-auto max-w-2xl text-center">
            <p className="font-display text-sm font-bold uppercase tracking-[0.22em] text-brand-700">The route</p>
            <h2 id="journey-title" className="mt-3 font-display text-3xl font-bold tracking-tight text-brand-950 sm:text-5xl">
              From kitchen heat to shelter tables.
            </h2>
            <p className="mt-4 text-stone-600 sm:text-lg">
              Every listing carries a safe-until deadline. RescuePlate keeps the path short enough for the food to stay good.
            </p>
          </div>

          <div className="lp-strips mt-14 flex h-[22rem] gap-2 overflow-hidden sm:h-[28rem] sm:gap-3 md:h-[32rem]">
            {STRIPS.map((s, i) => (
              <figure
                key={s.label}
                className={`lp-strip relative flex-1 overflow-hidden rounded-2xl ${i % 2 === 0 ? 'mt-0 self-start' : 'mt-8 self-end sm:mt-12'}`}
                style={{ maxWidth: i === 2 ? '22%' : undefined }}
              >
                <img src={s.src} alt="" className="lp-strip-img absolute inset-0 h-[120%] w-full object-cover" />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-950/80 to-transparent px-3 pb-3 pt-10 text-xs font-semibold text-white sm:text-sm">
                  {s.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* —— How it works —— */}
      <section id="how" className="bg-white px-5 py-20 sm:px-8 sm:py-28" aria-labelledby="how-title">
        <div className="mx-auto max-w-6xl">
          <div className="lp-how-copy max-w-2xl">
            <p className="font-display text-sm font-bold uppercase tracking-[0.22em] text-brand-700">How it works</p>
            <h2 id="how-title" className="mt-3 font-display text-3xl font-bold tracking-tight text-brand-950 sm:text-4xl">
              Three moves. No food left waiting on a WhatsApp thread.
            </h2>
          </div>
          <ol className="lp-steps mt-14 grid gap-12 border-t border-stone-200 pt-12 md:grid-cols-3 md:gap-10">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="font-display text-4xl font-extrabold text-amber-500">{s.n}</span>
                <h3 className="mt-3 font-display text-xl font-bold text-brand-900">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-stone-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* —— Why it matters (UNEP context, one job) —— */}
      <section className="lp-stats bg-brand-900 px-5 py-20 text-brand-50 sm:px-8 sm:py-24" aria-labelledby="why-title">
        <div className="mx-auto max-w-6xl">
          <h2 id="why-title" className="max-w-xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Built for the last few safe hours.
          </h2>
          <p className="mt-4 max-w-xl text-brand-100">
            Live claims, mapped pickups, and food-safety clocks — so surplus reaches people instead of the bin.
          </p>
          <dl className="mt-14 grid gap-10 sm:grid-cols-3">
            {[
              { v: '14.1m t', k: 'Food wasted in Bangladeshi homes each year' },
              { v: '82 kg', k: 'Per person each year (household estimate)' },
              { v: '19%', k: 'Of the world’s food wasted at consumer level' },
            ].map((x) => (
              <div key={x.v} className="lp-stat border-l border-amber-400/50 pl-5">
                <dt className="font-display text-4xl font-extrabold text-amber-300 sm:text-5xl">{x.v}</dt>
                <dd className="mt-2 text-sm text-brand-100">{x.k}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-xs text-brand-200">Source: UNEP Food Waste Index Report 2024.</p>
        </div>
      </section>

      {/* —— Close —— */}
      <section className="lp-close bg-[#f3f1ec] px-5 py-24 text-center sm:px-8 sm:py-32" aria-labelledby="close-title">
        <p id="close-title" className="font-display text-5xl font-extrabold tracking-tight text-brand-950 sm:text-6xl">
          RescuePlate
        </p>
        <p className="mx-auto mt-4 max-w-md text-lg text-stone-600">
          Good food should reach people, not the bin. Start with a demo account or register your organization.
        </p>
        <p className="mt-2 font-medium text-brand-800" lang="bn">
          খাবার নষ্ট নয়, পৌঁছে যাক মানুষের কাছে
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex min-h-12 items-center rounded-md bg-brand-800 px-7 py-3 text-sm font-bold text-white transition hover:bg-brand-900"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="inline-flex min-h-12 items-center rounded-md border border-brand-900/25 px-7 py-3 text-sm font-bold text-brand-950 transition hover:bg-white"
          >
            Create account
          </Link>
        </div>
        <p className="mt-16 text-xs text-stone-500">Hack the Vibe 2026 · World Problem Solver</p>
      </section>
    </div>
  );
}
