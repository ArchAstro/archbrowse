import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { SnapshotRefs } from '../src/agent/snapshot.js';

test('snapshot parser handles YAML-quoted accessible names and nested controls',async()=> {
  const names:string[]=[],refs=new SnapshotRefs();
  const page={
    on(){},url:()=> 'https://example.test/',title:async()=> 'Controls',
    locator:()=>({ariaSnapshot:async()=>`- main:\n  - heading "Controls" [level=1]\n  - 'button "Count: 0"'\n  - 'textbox "Name: full"'\n  - link "Learn more":\n    - /url: "#more"`}),
    getByRole:(_role:string,options:{name:string})=>({elementHandles:async()=>{names.push(options.name);return [{dispose:async()=>{},evaluate:async()=>true}];}}),
  } as unknown as Page;
  try {
    const snapshot=await refs.snapshot(page,true);
    assert.deepEqual(snapshot.refs.map(r=>[r.role,r.name]),[['button','Count: 0'],['textbox','Name: full'],['link','Learn more']]);
    assert.deepEqual(names,['Count: 0','Name: full','Learn more']);
    assert.ok(snapshot.tree.includes('Count: 0'));assert.equal(snapshot.tree.includes('heading'),false);
  } finally {refs.clear();}
});
