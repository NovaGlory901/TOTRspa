// Drawn icons instead of text characters. Phones show some characters (play, pause, arrows) from
// their colourful emoji font, which ignores the theme; these are plain shapes in the current text
// colour, so they look the same on every device and in every theme.
const svg = (children, extra = {}) => (
  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...extra}>
    {children}
  </svg>
);

export const Play = () => svg(<path d="M7 4.5v15l13-7.5z" />);
export const Pause = () => svg(<path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" />);
export const Prev = () => svg(<path d="M5.5 5h2.5v14H5.5zM19 5v14L9 12z" />);
export const Next = () => svg(<path d="M16 5h2.5v14H16zM5 5v14l10-7z" />);
export const Shuffle = () =>
  svg(
    <path d="M3 17h3c2 0 3.2-1 4.5-3l2-3c1.3-2 2.5-3 4.5-3h4M17.5 4.5L21 8l-3.5 3.5M3 7h3c1.4 0 2.4.5 3.3 1.5M13.2 15.5c.9 1 1.9 1.5 3.3 1.5h4M17.5 13.5L21 17l-3.5 3.5" />,
    { className: 'ico ico-line' },
  );
export const Search = () =>
  svg(
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M15 15l6 6" />
    </>,
    { className: 'ico ico-line' },
  );
