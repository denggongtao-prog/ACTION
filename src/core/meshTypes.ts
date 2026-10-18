/** Triangle coordinates are already transformed into machine-space millimetres.
 * Treat arrays as immutable after preparation; a new pose requires a new mesh. */
export type MeshPoint = [number, number, number];
export type MeshBounds = { min: MeshPoint; max: MeshPoint };
export type PreparedMesh = {
  objectId: string;
  role: 'stock' | 'fixture' | 'machine' | 'target';
  triangles: Float64Array;
  closed: boolean;
  bounds: MeshBounds;
  sha256?: string;
};
export type MeshStockColumns = {
  columns: number[][];
  /** Superset over each full XY cell, for conservative collision queries. */
  conservativeColumns: number[][];
  boundaryCells: boolean[];
  errorMm: number;
};
