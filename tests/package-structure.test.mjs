import assert from 'node:assert/strict';
import {readFile,access,readdir} from 'node:fs/promises';
const root=new URL('../extension/',import.meta.url);
for(const name of ['studio.html','popup.html']){
 const html=await readFile(new URL(name,root),'utf8');
 const styles=[...html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]);
 assert(styles.includes('studio.css')&&styles.includes('premium.css'),name+' must include both local style sheets');
 for(const path of styles){assert(!/^https?:/.test(path));await access(new URL(path,root));}
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'No duplicate IDs in '+name);
}
for(const name of await readdir(root))if(/\.(mjs|js)$/.test(name)){
 const js=await readFile(new URL(name,root),'utf8');for(const match of js.matchAll(/(?:from\s+|import\s*)['"](\.\/[^'"]+)['"]/g))await access(new URL(match[1],root));
}
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
for(const path of Object.values(manifest.icons))await access(new URL(path,root));
assert(!manifest.permissions.includes('unlimitedStorage'));
assert(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
console.log('PASS packaged style sheets, local asset/import references, unique UI IDs, minimum permissions and script CSP.');
