import { createSrcSet, parseSafeNumber } from '@nitedani/img-optimizer';
import { CSSProperties, useEffect, useMemo, useRef } from 'react';
import { ImageProps } from './types.js';

let observer: IntersectionObserver;
if (
  typeof window !== 'undefined' &&
  typeof IntersectionObserver !== 'undefined'
) {
  observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const image = entry.target as HTMLImageElement;
        if (image.dataset.srcset) {
          console.log('loading image', image.dataset.srcset);

          image.srcset = image.dataset.srcset;
        }
        observer.unobserve(image);
      }
    });
  });
}
const baseStyle: CSSProperties = {
  // objectFit: "contain",
};
const fillStyle: CSSProperties = {
  position: 'absolute',
  height: '100%',
  width: '100%',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  color: 'transparent',
};

export const Image = (props: ImageProps) => {
  const {
    src,
    width: widthProp,
    height: heightProp,
    quality,
    style,
    fill,
    loading,
    ...rest
  } = props;

  const height = parseSafeNumber(heightProp);
  const width = parseSafeNumber(widthProp);

  if (fill && (width || height)) {
    throw new Error(
      'You cannot specify both fill and width/height on an image'
    );
  }
  if ((!width || !height) && !fill) {
    throw new Error(
      'You must specify width and height on an image, or use fill'
    );
  }

  const _style: CSSProperties = fill
    ? { ...baseStyle, ...fillStyle, ...style }
    : {
        width,
        height,
        ...baseStyle,
        ...style,
      };

  const imgRef = useRef<HTMLImageElement>(null);
  const srcSet = useMemo(() => {
    return createSrcSet(src, width, quality);
  }, [quality, src, width]);

  const isLazy = loading !== 'eager';
  useEffect(() => {
    if (isLazy) {
      observer.observe(imgRef.current!);
    }
  }, [isLazy, src]);

  return (
    <img
      {...rest}
      ref={imgRef}
      style={_style}
      {...(isLazy
        ? {
            'data-srcset': srcSet,
          }
        : {
            srcSet,
          })}
    />
  );
};
