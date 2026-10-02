// Phase 0A import example only. Domain schemas belong to later phases.
export interface FoundationInfo {
  readonly productName: string;
  readonly phase: "Phase 0A";
  readonly status: "Foundation Ready";
}

export const foundation: FoundationInfo = Object.freeze({
  productName: "AI Video Editor",
  phase: "Phase 0A",
  status: "Foundation Ready",
});
