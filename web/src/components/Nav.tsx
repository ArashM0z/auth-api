export type NavCurrent = 'architecture' | 'api' | 'playground' | 'ratelimit';

/**
 * Shared top nav, reproducing the original pages' markup and class names.
 *
 * The original site has two visual variants with identical link styling:
 *  - index.html uses an inline `.nav` bar inside `.wrap` (margin-bottom 30px)
 *  - api/playground/ratelimit use a sticky `.topnav` bar above `.wrap`
 * The variant is derived from `current` so the CSS applies unchanged.
 */
export default function Nav({ current }: { current: NavCurrent }) {
  const here = (key: NavCurrent) => (current === key ? 'here' : undefined);
  return (
    <nav className={current === 'architecture' ? 'nav' : 'topnav'}>
      <a className={here('architecture')} href="index.html">
        Architecture
      </a>
      <a className={here('api')} href="api.html">
        API reference
      </a>
      <a className={here('playground')} href="playground.html">
        Playground
      </a>
      <a className={here('ratelimit')} href="ratelimit.html">
        Rate limiter
      </a>
      <a href="visual-guide.html">Visual guide</a>
      <a href="https://arashm0z.github.io/auth-api/docs/" target="_blank" rel="noopener">
        Docs &#8599;
      </a>
      <span className="sp"></span>
      <a href="https://github.com/ArashM0z/auth-api" target="_blank" rel="noopener">
        GitHub &#8599;
      </a>
    </nav>
  );
}
