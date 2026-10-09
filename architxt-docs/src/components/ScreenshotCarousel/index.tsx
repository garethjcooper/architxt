import React, {useCallback, useEffect, useState} from 'react';

interface CarouselSlide {
  title: string;
  src: string;
  alt: string;
}

interface ScreenshotCarouselProps {
  slides: CarouselSlide[];
  intervalMs?: number;
}

export default function ScreenshotCarousel({
  slides,
  intervalMs = 5000,
}: ScreenshotCarouselProps): JSX.Element | null {
  const [index, setIndex] = useState(0);

  const goTo = useCallback((i: number) => {
    setIndex(((i % slides.length) + slides.length) % slides.length);
  }, [slides.length]);

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(next, intervalMs);
    return () => clearInterval(timer);
  }, [next, intervalMs, slides.length]);

  if (slides.length === 0) return null;

  const current = slides[index];

  return (
    <div className="atx-carousel">
      <div className="atx-carousel-viewport">
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          className="atx-carousel-image"
          loading="lazy"
        />
      </div>

      <div className="atx-carousel-caption">
        <span className="atx-carousel-title">{current.title}</span>
        <span className="atx-carousel-counter">
          {index + 1} / {slides.length}
        </span>
      </div>

      {slides.length > 1 && (
        <div className="atx-carousel-controls">
          <button
            type="button"
            aria-label="Previous screenshot"
            onClick={prev}
            className="atx-carousel-button"
          >
            ‹
          </button>
          <div className="atx-carousel-dots">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => goTo(i)}
                className={
                  i === index
                    ? 'atx-carousel-dot atx-carousel-dot--active'
                    : 'atx-carousel-dot'
                }
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Next screenshot"
            onClick={next}
            className="atx-carousel-button"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
