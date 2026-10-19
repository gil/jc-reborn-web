export interface MapEntry { nameHash: number; offset: number; }

export interface ParsedArchive {
  byName: Map<string, RawResource>;
  list: RawResource[];
}

export interface RawResource {
  name: string;
  type: string;
  payload: Uint8Array; // after the 13-byte name and the u32 size
}
