// Fictional read-only browser cases. Rebuild dist before deploying to remove these files.
import {writeFile,mkdir,access} from 'node:fs/promises';
import {normalize,materialize} from '../worker/flights.ts';
await access('dist/index.html');
await mkdir('output/playwright',{recursive:true});
const flights=pairs=>pairs.map(([origin,destination],i)=>materialize(normalize({date:`2026-10-${String(i+1).padStart(2,'0')}`,origin,destination,flight_number:`QA${1000+i}`,airline:['演示航空','示例国际航空','示例环球航空'][i%3],marked_duration_minutes:120+i*25,source:'虚构演示',verification:'pending'}),`demo-${i}`,{is_demo:true}));
await writeFile('dist/_test-world.json',JSON.stringify(flights([['PVG','HND'],['HND','SFO'],['SFO','JFK'],['JFK','LHR'],['LHR','CDG'],['CDG','SIN'],['SIN','SYD'],['SYD','HKG'],['HKG','PVG'],['WUX','PKX']])));
await writeFile('dist/_test-china.json',JSON.stringify(flights([['WUX','PKX'],['PKX','WUX'],['WUX','SHA']])));
console.log('Prepared fictional browser cases in dist. Run Vite preview on port 8772; rebuild before deployment.');
