import {
  RangeValueControl,
  type RangeValueControlProps,
} from '../Inspector/controls/RangeValueControl';

/** RangeValueControl intentionally leaves visible headings to its owner. */
export function TonalSlider(props: RangeValueControlProps) {
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>{props.label}</span>
      </div>
      <RangeValueControl {...props} />
    </div>
  );
}
