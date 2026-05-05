import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);
console.log(`resFile=${map.resFileName} entries=${map.entries.length}`);
console.table(archive.list.map(r => ({ name: r.name, type: r.type, size: r.payload.length })));
