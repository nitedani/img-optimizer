import { SafeNumber } from '@nitedani/img-optimizer';
declare const VALID_LOADING_VALUES: readonly ['lazy', 'eager', undefined];
declare type LoadingValue = typeof VALID_LOADING_VALUES[number];
export declare type ImageProps = Omit<
  JSX.IntrinsicElements['img'],
  'src' | 'srcSet' | 'ref' | 'alt' | 'width' | 'height' | 'loading'
> & {
  src: string;
  alt: string;
  width?: SafeNumber;
  height?: SafeNumber;
  quality?: SafeNumber;
  fill?: boolean;
  loading?: LoadingValue;
};
