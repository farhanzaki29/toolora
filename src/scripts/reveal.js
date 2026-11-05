// Subtle scroll-reveal. Elements are visible by default; the `.js` class (set in Layout)
// only hides them once JS is confirmed running, so content never gets stuck invisible.
const items = document.querySelectorAll('[data-reveal]');

if ('IntersectionObserver' in window && items.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  items.forEach((el) => io.observe(el));
} else {
  items.forEach((el) => el.classList.add('is-visible'));
}
