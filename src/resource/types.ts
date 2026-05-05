export interface MapEntry { name: string; length: number; offset: number; }

export interface ParsedArchive {
  byName: Map<string, RawResource>;
  list: RawResource[];
}

export interface RawResource {
  name: string;            // e.g. "JOHNNY.TTM"
  type: string;            // ".TTM", ".BMP", etc.
  payload: Uint8Array;     // raw bytes (post-13-byte name, post-uint32 size header)
}
