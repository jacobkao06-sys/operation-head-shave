/**
 * One "LABEL ..... value" row. SPEC.md §5 asked for a terminal status block;
 * this keeps that reading at desktop width while degrading to a stacked
 * label/value pair on a phone, where a hand-padded string inside a <pre> wrapped
 * mid-value and ran the leader dots into the data.
 */
export function KeyValue({
  k,
  v,
  wrap = false,
}: {
  k: string;
  v: string;
  /** Long values (a full local timestamp) may wrap instead of overflowing. */
  wrap?: boolean;
}) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-lead" aria-hidden="true" />
      <span className="kv-v" data-wrap={wrap ? "true" : undefined}>
        {v}
      </span>
    </div>
  );
}
