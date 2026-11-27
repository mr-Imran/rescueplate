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

const IMG = {
  kitchen: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=900&q=80',
  packing: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=900&q=80',
  meal: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=700&q=80',
};

function ArrowIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 ${className}`} fill="none" aria-hidden="true">
      <path d="M4 10h10M10 5l5 5-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Post surplus',
    body: 'Kitchens list leftover meals with a hard safe-until time. The feed updates the moment food goes live.',
  },
  {
    n: '02',
    title: 'Claim nearby',
    body: 'NGOs see distance, capacity, and travel time. Claims that would expire on the road are blocked.',
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
        gsap.set('.lp-anim, .lp-tile, .lp-chip, .lp-mosaic-copy > *', { clearProps: 'all', opacity: 1, y: 0, scale: 1, rotate: 0 });
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

      // Mosaic: headline, then tiles pop in left→right with alternating height, then soft float.
      gsap.set('.lp-tile', { opacity: 0, y: 90, scale: 0.88, rotate: 2 });
      gsap.set('.lp-chip', { opacity: 0, y: 24, scale: 0.9 });
      gsap.set('.lp-mosaic-copy > *', { opacity: 0, y: 40 });

      const mosaic = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: '#mosaic',
          start: 'top 70%',
          toggleActions: 'play none none reverse',
        },
      });

      mosaic
        .to('.lp-mosaic-copy > *', { opacity: 1, y: 0, duration: 0.7, stagger: 0.14 })
        .to(
          '.lp-tile',
          {
            opacity: 1,
            y: (i) => (i % 2 === 0 ? 0 : 28),
            scale: 1,
            rotate: 0,
            duration: 0.95,
            stagger: { each: 0.14, from: 'start' },
            ease: 'back.out(1.35)',
          },
          '-=0.25',
        )
        .to('.lp-chip', { opacity: 1, y: 0, scale: 1, duration: 0.55, stagger: 0.12, ease: 'back.out(1.6)' }, '-=0.45')
        .add(() => {
          const num = root.current?.querySelector('.lp-stat-num');
          if (!num) return;
          const obj = { n: 0 };
          gsap.to(obj, {
            n: 82,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate: () => {
              num.textContent = String(Math.round(obj.n));
            },
          });
        }, '-=0.9')
        .add(() => {
          // Idle bob only after the stagger lands, so it doesn't fight the entrance.
          gsap.utils.toArray('.lp-tile').forEach((tile, i) => {
            gsap.to(tile, {
              y: `+=${i % 2 === 0 ? 10 : -12}`,
              duration: 2.4 + i * 0.25,
              yoyo: true,
              repeat: -1,
              ease: 'sine.inOut',
              delay: i * 0.1,
            });
          });
          gsap.utils.toArray('.lp-tile-photo img').forEach((img) => {
            gsap.fromTo(img, { scale: 1 }, { scale: 1.08, duration: 8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
          });
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

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-5 pb-24 pt-10 text-center sm:px-8">
          <p
            className="lp-anim inline-flex max-w-full whitespace-nowrap font-display text-[clamp(2.15rem,11vw,6.5rem)] font-extrabold leading-none tracking-tight"
            aria-label="RescuePlate"
          >
            {'RescuePlate'.split('').map((ch, i) => (
              <span key={`${ch}${i}`} className="lp-brand-letter inline-block">
                {ch}
              </span>
            ))}
          </p>
          <h1 className="lp-hero-line lp-anim mt-6 max-w-3xl font-display text-2xl font-semibold leading-snug text-amber-200 sm:text-3xl md:text-4xl">
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
          href="#mosaic"
          className="lp-scroll-hint lp-anim absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
        >
          Scroll
        </a>
      </header>

      {/* —— Staggered mosaic (charity-collage layout) —— */}
      <section id="mosaic" className="bg-[#f4f2ed] px-4 py-16 sm:px-8 sm:py-24" aria-labelledby="mosaic-title">
        <div className="mx-auto max-w-6xl">
          <div className="lp-mosaic-copy mx-auto max-w-3xl text-center">
            <h2 id="mosaic-title" className="font-display text-3xl font-bold tracking-tight text-stone-900 sm:text-5xl">
              Great kitchens leave surplus. Great networks move it.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-stone-600 sm:text-lg">
              RescuePlate connects donors, NGOs and volunteers in real time — so meals leave the counter while they are still safe to eat.
            </p>
          </div>

          <div className="lp-mosaic mt-14 flex gap-3 overflow-x-auto pb-4 sm:gap-4 lg:overflow-visible lg:pb-0">
            {/* Col 1 — impact + tag */}
            <div className="lp-tile flex w-[11.5rem] shrink-0 flex-col gap-3 will-change-transform sm:w-[13rem]">
              <div className="lp-tile-inner flex flex-1 flex-col justify-between rounded-[1.6rem] bg-brand-800 p-5 text-white sm:min-h-[17rem]">
                <p className="lp-stat-num font-display text-5xl font-extrabold tracking-tight sm:text-6xl">0</p>
                <p className="mt-3 text-sm leading-snug text-brand-100">kg of household food waste per person each year in Bangladesh.</p>
                <a href="#how" className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-lime-300 text-brand-950 transition hover:bg-lime-200" aria-label="How it works">
                  <ArrowIcon />
                </a>
              </div>
              <div className="lp-chip inline-flex items-center gap-2 self-start rounded-2xl bg-stone-800 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white">
                <span className="inline-block h-2 w-2 rounded-sm bg-amber-400" aria-hidden="true" />
                Food, not waste
              </div>
            </div>

            {/* Col 2 — tall photo */}
            <figure className="lp-tile lp-tile-photo relative h-[20rem] w-[12.5rem] shrink-0 overflow-hidden rounded-[1.6rem] will-change-transform sm:h-[24rem] sm:w-[14.5rem]">
              <img src={IMG.kitchen} alt="" className="absolute inset-0 h-full w-full origin-center object-cover" />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-16 text-sm font-semibold leading-snug text-white">
                Kitchen surplus posted with a hard safe-until deadline
              </figcaption>
            </figure>

            {/* Col 3 — join (offset down) */}
            <div className="lp-tile flex w-[12rem] shrink-0 flex-col justify-end will-change-transform sm:w-[13.5rem] lg:mt-10">
              <div className="lp-tile-inner rounded-[1.6rem] bg-stone-200/90 p-5">
                <p className="font-display text-2xl font-bold leading-tight text-stone-900">Join kitchens &amp; NGOs already on the network</p>
                <Link
                  to="/register"
                  className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-800"
                >
                  Join RescuePlate
                  <ArrowIcon className="text-lime-300" />
                </Link>
              </div>
            </div>

            {/* Col 4 — tall photo */}
            <figure className="lp-tile lp-tile-photo relative h-[20rem] w-[12.5rem] shrink-0 overflow-hidden rounded-[1.6rem] will-change-transform sm:h-[24rem] sm:w-[14.5rem]">
              <img src={IMG.packing} alt="" className="absolute inset-0 h-full w-full origin-center object-cover" />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-16 text-sm font-semibold leading-snug text-white">
                Volunteers collect and deliver before the clock runs out
              </figcaption>
            </figure>

            {/* Col 5 — gallery lime + tag */}
            <div className="lp-tile flex w-[12rem] shrink-0 flex-col gap-3 will-change-transform sm:w-[13.5rem]">
              <div className="lp-tile-inner flex flex-1 flex-col rounded-[1.6rem] bg-lime-300 p-5 text-brand-950 sm:min-h-[17rem]">
                <p className="font-display text-3xl font-extrabold tracking-tight">Impact</p>
                <img src={IMG.meal} alt="" className="mt-4 h-28 w-full rounded-2xl object-cover" />
                <Link to="/login" className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-bold">
                  See the live demo
                  <ArrowIcon />
                </Link>
              </div>
              <div className="lp-chip inline-flex items-center gap-2 self-start rounded-2xl bg-stone-800 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500" aria-hidden="true" />
                Kitchen to shelter
              </div>
            </div>
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
